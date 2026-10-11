// Rodar com: node --test "tft/helper/tests/meta-store.test.mjs"
// A extensão MetaTFT offline (meta-store.mjs) com disco real e a rede trocada por respostas no formato da MetaTFT:
// rede ok, rede fora, cópia corrompida, resposta ruim, troca de patch, prazo estourado e o snapshot do repositório.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createMetaStore, failureKind, formatAge } from "../meta-store.mjs";
import { writeFileAtomic } from "../meta-files.mjs";
import { refreshComps } from "../meta-comps.mjs";
import { refreshMeta } from "../meta-builds.mjs";
import { refreshStats } from "../meta-stats.mjs";
import { refreshAugmentStats } from "../augment-stats.mjs";
import { METATFT_SCOPE } from "../meta-scope.mjs";

const SET = "TFTSet18";
const FILES = {
  comps: "meta-comps.json",
  builds: "meta-builds.json",
  stats: "meta-stats.json",
  augments: "augment-stats.json",
};
const catalog = {
  champions: ["A", "B", "C", "D", "E"].map((id) => ({
    apiName: id,
    name: `Campeão ${id}`,
    cost: 1,
  })),
  traits: [{ apiName: "A", name: "Traço A" }],
};

/**
 * Respostas no formato dos endpoints da MetaTFT/NoxuTFT (só os campos que os leitores consomem). Como a MetaTFT real:
 * o explorer sem o recorte (meta-scope.mjs) responde com outro set (ids TFT17_*), e o `comps_stats` não traz mais o patch.
 */
function fakeNet({ patch = "16.5", set = SET, games = 6000 } = {}) {
  const base = patch.replace(/b$/, ""),
    suffix = patch.endsWith("b") ? "b" : "";
  let scoped = false;
  const rows = (key, id) =>
    (scoped ? ["A", "B", "C"] : ["TFT17_Vex"]).map((unit) => ({
      [key]: id.replace("A", unit),
      avg_placement: 4.4,
      total_games: 120,
    }));
  const aug = Array.from(
    { length: 25 },
    (_, i) =>
      `<tr data-row data-s-place="4.4" data-s-games="100" data-s-top4="55" data-s-at21="4.3" data-s-at32="4.4" data-s-at42="4.5"><td data-tt="aug:Aug${i}"></td></tr>`,
  ).join("");
  return (url) => {
    const full = new URL(String(url));
    const u = full.origin + full.pathname;
    scoped = full.search.includes(METATFT_SCOPE);
    const json = (body) => new Response(JSON.stringify(body));
    if (u.includes("/comps_data"))
      return json({
        results: {
          data: {
            tft_set: set,
            cluster_details: {
              100: {
                units_string: "A, B, C, D, E",
                name: [{ name: "A" }],
                levelling: "lvl 8",
                stars: ["A"],
                builds: [
                  {
                    unit: "A",
                    buildName: ["Item1", "Item2"],
                    score: 1,
                    avg: 4,
                    place_change: -0.2,
                    count: 80,
                  },
                ],
              },
            },
          },
        },
      });
    if (u.includes("/comps_stats"))
      return json({
        results: [
          {
            cluster: "100",
            places: [
              games / 4,
              games / 4,
              games / 8,
              games / 8,
              0,
              0,
              0,
              games / 4,
            ],
          },
        ],
        filter_adjustment: { override_applied: false },
      });
    if (u.includes("/unit_items_processed"))
      return json({
        tft_set: set,
        units: { A: { items: [{ itemName: "Item1" }, { itemName: "Item2" }] } },
        itemNames: {
          Item1: { avg: 4.2, count: 300, pick: 0.1, units: [{ unit: "A" }] },
        },
        region_patch_adjustment: {
          selected_patch: { patch: base, b_patch_version: suffix },
        },
        overall: { count: 9000 },
      });
    if (u.endsWith("/total")) return json(rows("x", "x"));
    if (u.endsWith("/unit_tier")) return json(rows("unit_tier", "A_1"));
    if (u.endsWith("/unit_tier_numitems_unique"))
      return json(rows("unit_tier_numitems_unique", "A-1_3_2"));
    if (u.endsWith("/unit_items_unique"))
      return json(rows("unit_items_unique", "A-1&Item1-1"));
    if (u.endsWith("/traits")) return json(rows("traits", "A_2"));
    if (u.includes("noxutft.com")) return new Response(`<table>${aug}</table>`);
    if (u.includes("/comp_augment_tiers"))
      return json({
        results: { 100: { augments: [{ id: "Aug1", tier: "S" }] } },
      });
    return new Response("?", { status: 404 });
  };
}

/** Roda `fn` com `fetch` trocado; `handler` recebe (url, init) e devolve uma Response ou lança. */
async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(url, init);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}
const offline = () => {
  throw Object.assign(TypeError("fetch failed"), {
    cause: { code: "ENOTFOUND" },
  });
};

const tmp = (t) =>
  fs.mkdtemp(path.join(os.tmpdir(), "meta-store-")).then((d) => {
    t.after(() => fs.rm(d, { recursive: true, force: true }));
    return d;
  });

/** Pasta "do repositório" com os quatro snapshots no formato real, datados de `ageMs` atrás. */
async function seedRepo(t, ageMs = 3 * 86_400_000, patch = "16.0") {
  const root = await tmp(t);
  await withFetch(fakeNet({ patch }), async () => {
    await refreshComps(root, SET);
    await refreshMeta(root, SET);
    await refreshStats(root, SET);
    await refreshAugmentStats(root);
  });
  const at = new Date(Date.now() - ageMs).toISOString();
  for (const f of Object.values(FILES)) {
    const file = path.join(root, f);
    const json = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.writeFile(file, JSON.stringify({ ...json, fetchedAt: at }));
  }
  return root;
}
const digest = async (root) => {
  const h = createHash("sha256");
  for (const f of Object.values(FILES))
    h.update(await fs.readFile(path.join(root, f)));
  return h.digest("hex");
};
const listing = async (dir, name) =>
  (await fs.readdir(path.join(dir, name)).catch(() => [])).sort();

test("primeira execução sem rede: usa o snapshot do repositório, avisa e não grava nada", async (t) => {
  const root = await seedRepo(t);
  const before = await digest(root);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET });
  const loaded = await store.load("comps", { catalog });
  assert.equal(loaded.info.origin, "repositorio");
  assert.equal(loaded.value.comps.length, 1);
  assert.equal(loaded.value.comps[0].carry, "A");
  assert.equal(loaded.info.stale, true);

  const r = await withFetch(offline, () => store.sync({ catalog }));
  assert.equal(r.mode, "offline");
  assert.equal(
    r.line,
    "meta offline: dados de 3 d atrás (snapshot do repositório)",
  );
  for (const n of Object.keys(FILES)) {
    assert.equal(r.results[n].status, "falhou");
    assert.equal(r.results[n].kind, "rede");
  }
  // O que o servidor passa a ler continua sendo o mesmo snapshot, o repositório não foi reescrito e a tentativa ficou registrada.
  assert.equal((await store.load("builds")).info.origin, "repositorio");
  assert.equal(await digest(root), before);
  assert.deepEqual(await listing(dir, "comps"), []);
  assert.equal(store.freshness("comps").mode, "offline");
  assert.equal(store.status().mode, "offline");
  const saved = JSON.parse(
    await fs.readFile(path.join(dir, "status.json"), "utf8"),
  );
  assert.equal(saved.attempts.comps.kind, "rede");
});

test("sem nenhuma cópia (nem repositório): origem ausente, valores vazios e sem exceção", async (t) => {
  const store = createMetaStore({
    root: await tmp(t),
    dir: path.join(await tmp(t), "store"),
    set: SET,
  });
  const c = await store.load("comps", { catalog });
  assert.equal(c.info.origin, "ausente");
  assert.deepEqual(c.value.comps, []);
  assert.equal((await store.load("builds")).value.builds.size, 0);
  assert.equal((await store.load("stats")).value, null);
  const r = await withFetch(offline, () => store.sync());
  assert.equal(r.line, "meta offline: sem dados (sem nenhuma cópia)");
});

test("rede ok: baixa, valida, grava por patch e passa a ler a cópia local; repositório intocado", async (t) => {
  const root = await seedRepo(t);
  const before = await digest(root);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET });
  const r = await withFetch(fakeNet({ patch: "16.5b" }), () =>
    store.sync({ catalog }),
  );
  assert.equal(
    r.line,
    "meta atualizada (comps, builds, estatísticas, aprimoramentos; patch 16.5b)",
  );
  assert.equal(r.mode, "em-dia");
  assert.deepEqual(await listing(dir, "builds"), [`${SET}__16.5b.json`]);
  assert.deepEqual(await listing(dir, "comps"), [`${SET}__16.5b.json`]);

  const builds = await store.load("builds");
  assert.equal(builds.info.origin, "local");
  assert.equal(builds.info.patch, "16.5b");
  assert.equal(builds.info.stale, false);
  assert.equal(builds.value.label, "MetaTFT 16.5b");
  assert.deepEqual(builds.value.builds.get("A"), ["Item1", "Item2"]);
  assert.equal((await store.load("augments")).value.augments.Aug1.games, 100);
  assert.equal(store.freshness("builds").mode, "em-dia");
  assert.equal(store.status().datasets.comps.origin, "local");
  assert.equal(await digest(root), before);

  // Em dia: uma segunda sincronização não baixa nada.
  const calls = await withFetch(fakeNet(), async (c) => {
    const again = await store.sync({ catalog });
    assert.match(again.line, /^meta em dia \(dados de menos de 1 min atrás\)$/);
    return c;
  });
  assert.deepEqual(calls, []);
});

test("cópia corrompida ou fora do esquema cai na cópia anterior e depois no repositório", async (t) => {
  const root = await seedRepo(t);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET });
  await withFetch(fakeNet({ patch: "16.5" }), async () => {
    await store.sync({ catalog });
    await new Promise((r) => setTimeout(r, 15));
    await store.sync({ catalog, force: true }); // a primeira vira .prev
  });
  assert.deepEqual(await listing(dir, "builds"), [
    `${SET}__16.5.json`,
    `${SET}__16.5.prev.json`,
  ]);
  const current = path.join(dir, "builds", `${SET}__16.5.json`);

  // JSON cortado ao meio (queda de energia, disco cheio): lê a anterior e conta o problema.
  const whole = await fs.readFile(current, "utf8");
  await fs.writeFile(current, whole.slice(0, whole.length / 2));
  const a = await store.load("builds");
  assert.equal(a.info.origin, "local");
  assert.equal(a.info.recovered, true);
  assert.match(a.info.problems[0].reason, /JSON inválido/);
  assert.equal(a.value.builds.size, 1);

  // JSON válido mas fora do esquema (outro formato, outro set): também é recusado.
  await fs.writeFile(
    current,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      set: SET,
      units: [],
    }),
  );
  assert.match(
    (await store.load("builds")).info.problems[0].reason,
    /sem builds/,
  );
  await fs.writeFile(
    current,
    JSON.stringify({ ...JSON.parse(whole), set: "TFTSet99" }),
  );
  assert.match(
    (await store.load("builds")).info.problems[0].reason,
    /TFTSet99/,
  );

  // Corrompidas as duas: o snapshot do repositório assume.
  await fs.writeFile(current, "{");
  await fs.writeFile(current.replace(".json", ".prev.json"), "");
  const c = await store.load("builds");
  assert.equal(c.info.origin, "repositorio");
  assert.equal(c.info.problems.length, 2);
  assert.equal(c.value.builds.size, 1);
});

test("resposta ruim da rede não substitui a cópia boa", async (t) => {
  const root = await seedRepo(t);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET });
  await withFetch(fakeNet(), () => store.sync({ catalog }));
  const good = path.join(dir, "builds", `${SET}__16.5.json`);
  const text = await fs.readFile(good, "utf8");

  const bad = [
    ["set errado", fakeNet({ set: "TFTSet99" }), /TFTSet99/],
    ["HTTP 503", () => new Response("x", { status: 503 }), /503/],
    [
      "sem builds",
      (u) =>
        String(u).includes("unit_items_processed")
          ? new Response(JSON.stringify({ tft_set: SET, units: {} }))
          : fakeNet()(u),
      /não devolveu builds/,
    ],
  ];
  for (const [nome, handler, why] of bad) {
    const r = await withFetch(handler, () =>
      store.refresh("builds", { catalog }),
    );
    assert.equal(r.ok, false, nome);
    assert.equal(r.kind, "recusada", nome);
    assert.match(r.error.message, why, nome);
  }
  assert.equal(await fs.readFile(good, "utf8"), text);
  assert.deepEqual(await listing(dir, "builds"), [`${SET}__16.5.json`]);
  assert.equal((await store.load("builds")).info.origin, "local");
  // Nenhuma pasta de preparo sobra.
  assert.deepEqual(
    (await fs.readdir(dir)).filter((f) => f.startsWith(".staging-")),
    [],
  );
});

test("troca de patch: cada patch tem o seu arquivo, o mais novo vale e o anterior serve de reserva; só 3 ficam", async (t) => {
  const root = await seedRepo(t);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET });
  await withFetch(fakeNet({ patch: "16.5" }), () => store.sync({ catalog }));
  await new Promise((r) => setTimeout(r, 15)); // fetchedAt distinto
  const r = await withFetch(fakeNet({ patch: "16.6" }), () =>
    store.sync({ catalog, force: true }),
  );
  assert.match(r.line, /patch 16\.6\)$/);
  assert.deepEqual(await listing(dir, "builds"), [
    `${SET}__16.5.json`,
    `${SET}__16.6.json`,
  ]);
  assert.equal((await store.load("builds")).info.patch, "16.6");

  // O patch novo corrompido: a leitura volta ao patch anterior em vez de ficar sem nada.
  await fs.writeFile(path.join(dir, "builds", `${SET}__16.6.json`), "lixo");
  const back = await store.load("builds");
  assert.equal(back.info.patch, "16.5");
  assert.equal(back.info.recovered, true);

  for (const p of ["16.7", "16.8", "16.9"]) {
    await new Promise((r) => setTimeout(r, 15));
    await withFetch(fakeNet({ patch: p }), () => store.refresh("builds"));
  }
  const kept = (await listing(dir, "builds")).filter(
    (f) => !f.endsWith(".prev.json"),
  );
  assert.deepEqual(kept, [
    `${SET}__16.7.json`,
    `${SET}__16.8.json`,
    `${SET}__16.9.json`,
  ]);
});

test("prazo estourado: a sincronização volta no teto, como offline, e mantém a cópia local", async (t) => {
  const root = await seedRepo(t);
  const store = createMetaStore({
    root,
    dir: path.join(await tmp(t), "store"),
    set: SET,
  });
  const hang = (url, init) =>
    new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason)),
    );
  const t0 = Date.now();
  const r = await withFetch(hang, () => store.sync({ catalog, timeoutMs: 80 }));
  assert.ok(
    Date.now() - t0 < 3000,
    "não pode esperar o prazo próprio de cada requisição (20 a 40 s)",
  );
  assert.equal(r.mode, "offline");
  assert.equal(r.results.comps.kind, "tempo");
  assert.match(r.line, /^meta offline: /);
  assert.equal(
    (await store.load("comps", { catalog })).info.origin,
    "repositorio",
  );
});

test("aprimoramentos: a fonte que falha mantém a metade da cópia anterior", async (t) => {
  const root = await seedRepo(t);
  const store = createMetaStore({
    root,
    dir: path.join(await tmp(t), "store"),
    set: SET,
  });
  const net = fakeNet();
  const noxuDown = (u) => (String(u).includes("noxutft") ? offline() : net(u));
  const r = await withFetch(noxuDown, () => store.refresh("augments"));
  assert.equal(r.ok, true);
  // As colocações medidas vieram da cópia do repositório; os tiers, da rede.
  assert.equal(r.value.augments.Aug1.games, 100);
  assert.equal(r.value.compTiers[100].Aug1, "S");
});

test("gravação atômica: nunca deixa arquivo parcial ou temporário", async (t) => {
  const d = await tmp(t);
  const f = path.join(d, "sub", "x.json");
  await writeFileAtomic(f, "um");
  await writeFileAtomic(f, "dois");
  assert.equal(await fs.readFile(f, "utf8"), "dois");
  assert.deepEqual(await fs.readdir(path.join(d, "sub")), ["x.json"]);
  // Destino impossível (a "pasta" é um arquivo): falha e não deixa o temporário.
  await assert.rejects(writeFileAtomic(path.join(f, "y.json"), "x"));
  assert.deepEqual(await fs.readdir(path.join(d, "sub")), ["x.json"]);
});

test("falhas são classificadas e a idade é legível", () => {
  assert.equal(failureKind(TypeError("fetch failed")), "rede");
  assert.equal(
    failureKind(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    ),
    "tempo",
  );
  assert.equal(failureKind(Error("MetaTFT respondeu 500")), "recusada");
  assert.deepEqual([0, 90_000, 3 * 3_600_000, 50 * 3_600_000].map(formatAge), [
    "menos de 1 min",
    "1 min",
    "3 h",
    "2 d",
  ]);
});

test("scripts/meta-sync.mjs: sem rede imprime uma linha, sai com 0 e não grava no repositório", async (t) => {
  const { execFile } = await import("node:child_process");
  const helper = path.resolve(import.meta.dirname, "..");
  const dir = path.join(await tmp(t), "store");
  const out = await new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [
        "--import",
        pathToFileURL(
          path.join(import.meta.dirname, "fixtures", "offline-fetch.mjs"),
        ).href,
        path.join(helper, "scripts", "meta-sync.mjs"),
        `--dir=${dir}`,
        "--force",
        "--timeout=3000",
      ],
      { encoding: "utf8", timeout: 20_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    ),
  );
  const lines = out.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /^meta offline: dados de .+ atrás \((snapshot do repositório|cópia local)\)$/,
  );
  // Falhou tudo: nada novo foi gravado na pasta de snapshots do usuário.
  assert.deepEqual(await listing(dir, "comps"), []);
});

// Catálogo em que as estatísticas do fakeNet (peças A, B e C; sinergias A, B e C) cobrem o set.
const statsCatalog = {
  champions: ["A", "B", "C", "D"].map((apiName) => ({ apiName })),
  traits: ["A", "B", "C"].map((apiName) => ({ apiName })),
};
/** Uma cópia de meta-stats no formato certo, mas com ids de outro set (o que a MetaTFT devolve sem o recorte). */
const statsOfOtherSet = (fetchedAt) => ({
  source: "explorer sem recorte",
  fetchedAt,
  set: SET,
  base: [4.5, 12616],
  unit: {
    "TFT17_Vex|2": [4.1, 900],
    "TFT17_Vex|2|3": [3.9, 400],
    TFT17_Vex: [4.2, 1300],
  },
  unitItem: { "TFT17_Vex|TFT_Item_GuinsoosRageblade": [4.0, 300] },
  trait: { "TFT17_Mage|1": [4.4, 2000] },
});

test("estatísticas: pedidas com o recorte comum, com o patch e só aceitas se forem do set do catálogo", async (t) => {
  const root = await seedRepo(t);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET, catalog: statsCatalog });

  // Download: todas as tabelas do explorer vão com o recorte (o mesmo das comps) e o arquivo traz o patch.
  const calls = await withFetch(fakeNet({ patch: "16.5b" }), async (c) => {
    const r = await store.refresh("stats");
    assert.equal(r.ok, true, r.error?.message);
    return c;
  });
  const explorerCalls = calls.filter((u) => u.includes("/tft-explorer-api/"));
  assert.equal(explorerCalls.length, 5);
  for (const u of explorerCalls) assert.ok(u.includes(`?${METATFT_SCOPE}`), u);
  assert.deepEqual(await listing(dir, "stats"), [`${SET}__16.5b.json`]);
  const good = await store.load("stats");
  assert.equal(good.info.patch, "16.5b");
  assert.deepEqual(good.value.unit["B|1"], [4.4, 120]);
  assert.equal(store.freshness("stats").outOfSet, false);

  // Uma cópia mais nova, mas de outro set (TFT17_*), é recusada na leitura e marcada "fora do set"; vale a boa.
  await writeFileAtomic(
    path.join(dir, "stats", `${SET}__sem-patch.json`),
    JSON.stringify(
      statsOfOtherSet(new Date(Date.now() + 60_000).toISOString()),
    ),
  );
  const again = await store.load("stats");
  assert.equal(again.info.patch, "16.5b");
  assert.equal(again.info.recovered, true);
  assert.match(
    again.info.problems.find((p) => p.path.endsWith("sem-patch.json")).reason,
    /^fora do set: 0 de 4 campeões e 0 de 3 sinergias do catálogo têm estatística \(ids de outro set, ex\.: TFT17_Vex\)$/,
  );
  assert.equal(store.freshness("stats").outOfSet, true);

  // A MetaTFT ignorando o recorte (responde outro set mesmo com ele): o download é recusado e a cópia boa fica.
  const before = await fs.readFile(
    path.join(dir, "stats", `${SET}__16.5b.json`),
    "utf8",
  );
  const net = fakeNet({ patch: "16.5b" });
  const ignoresScope = (url) => net(String(url).replace(/\?.*$/, "")); // o fakeNet vê a consulta sem o recorte
  const bad = await withFetch(ignoresScope, () => store.refresh("stats"));
  assert.equal(bad.ok, false);
  assert.equal(bad.kind, "recusada");
  assert.match(bad.error.message, /não passou na validação: fora do set/);
  assert.equal(
    await fs.readFile(path.join(dir, "stats", `${SET}__16.5b.json`), "utf8"),
    before,
  );
});

test("estatísticas: snapshot do repositório de outro set não é usado (fica ausente e marcado)", async (t) => {
  const root = await tmp(t);
  await fs.writeFile(
    path.join(root, "meta-stats.json"),
    JSON.stringify(statsOfOtherSet(new Date().toISOString())),
  );
  // Sem `catalog` na criação: vale o catalog.json da pasta do helper.
  await fs.writeFile(
    path.join(root, "catalog.json"),
    JSON.stringify(statsCatalog),
  );
  const store = createMetaStore({
    root,
    dir: path.join(await tmp(t), "store"),
    set: SET,
  });
  const r = await store.load("stats");
  assert.equal(r.value, null);
  assert.equal(r.info.origin, "ausente");
  assert.match(r.info.problems[0].reason, /^fora do set:/);
  assert.equal(store.freshness("stats").outOfSet, true);
  // A mesma cópia passa quando não há catálogo para medir (checagem desligada, como antes).
  await fs.rm(path.join(root, "catalog.json"));
  const blind = createMetaStore({
    root,
    dir: path.join(await tmp(t), "store"),
    set: SET,
  });
  assert.equal((await blind.load("stats")).info.origin, "repositorio");
});

test("comps: o patch vem de unit_items_processed quando comps_stats não o traz", async (t) => {
  const root = await tmp(t);
  await withFetch(fakeNet({ patch: "18.4b" }), () => refreshComps(root, SET));
  const file = JSON.parse(
    await fs.readFile(path.join(root, "meta-comps.json"), "utf8"),
  );
  assert.equal(file.patch, "18.4b");
  // Sem o patch publicado (rota fora do ar), as comps ainda são gravadas, com patch null.
  const net = fakeNet();
  await withFetch(
    (u) =>
      String(u).includes("unit_items_processed")
        ? new Response("x", { status: 503 })
        : net(u),
    () => refreshComps(root, SET),
  );
  assert.equal(
    JSON.parse(await fs.readFile(path.join(root, "meta-comps.json"), "utf8"))
      .patch,
    null,
  );
});

test("embed (meta-sync --embed): regrava o snapshot do repositório só com a cópia baixada e validada", async (t) => {
  const root = await seedRepo(t);
  const dir = path.join(await tmp(t), "store");
  const store = createMetaStore({ root, dir, set: SET, catalog: statsCatalog });
  // Nada baixado: não há cópia local, o repositório fica como está.
  assert.equal(await store.embed("stats"), null);
  await withFetch(fakeNet({ patch: "16.5b" }), () => store.refresh("stats"));
  const target = await store.embed("stats");
  assert.equal(target, path.join(root, "meta-stats.json"));
  const embedded = JSON.parse(await fs.readFile(target, "utf8"));
  assert.equal(embedded.patch, "16.5b");
  assert.equal(
    await fs.readFile(target, "utf8"),
    await fs.readFile(path.join(dir, "stats", `${SET}__16.5b.json`), "utf8"),
  );
});
