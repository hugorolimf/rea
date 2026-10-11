// Rodar com: node --test tft/helper/tests/no-screen.test.mjs
// O estado só com o GEP (plano PLANO-REMOVER-OCR.md, P0 a P2/P4): uma partida gravada passa pelo montador de estado
// (app/state.mjs), que não tem leitura de tela, e o GEP ausente ou obsoleto deixa cada campo desconhecido, com o motivo.
// Fixa também a chave de análise (core/state/analysis-key.mjs) desses estados contra uma cópia congelada da regra.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gepReader } from "../gep-reader.mjs";
import { createStateHub } from "../app/state.mjs";
import { levelFloor } from "../core/state/level.mjs";
import {
  REFRESH_WINDOW_MS,
  analysisKey,
  decisionPayload,
} from "../core/state/analysis-key.mjs";
import { buildModel } from "../v2/js/model.js";

const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/gep-events.json", import.meta.url),
    "utf8",
  ),
);
const catalog = JSON.parse(
  fs.readFileSync(new URL("../catalog.json", import.meta.url), "utf8"),
);
const BASE = 1_800_000_000; // segundos; o `dt` do fixture soma a isto
const GAME_ID = "1000000001";
const ctx = { gameId: GAME_ID, inMatch: true, set: 18, local: fixture.local };
const SCHEMA = `
  CREATE TABLE games (id text PRIMARY KEY NOT NULL, started_at integer NOT NULL, ended_at integer, game_version text,
    set_number real, player_puuid text, final_placement integer, queue_type integer, created_at integer NOT NULL, match_id text);
  CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, game_id text NOT NULL, timestamp integer NOT NULL,
    event_type text NOT NULL, player_id text, round text, stage_type text, key text, data text, created_at integer NOT NULL,
    feature text, category text, FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE);`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "no-screen-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const noGameFiles = { status: () => ({ available: false, stage: null }) };
const sentryAt = (stage) => ({
  status: () => ({
    available: true,
    stage,
    phase: "Planning",
    phaseKind: "planning",
  }),
});

/** Banco no esquema do TFTAcademy, vazio de eventos; `push(dt)` grava as linhas do fixture até `dt`. */
function recordedMatch() {
  const file = path.join(tmp, `match-${Date.now()}-${Math.random()}.db`),
    db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  const g = fixture.game;
  db.prepare(
    "INSERT INTO games (id, started_at, ended_at, set_number, queue_type, created_at, match_id) VALUES (?,?,?,?,?,?,?)",
  ).run(g.id, BASE, null, g.set, g.queue, BASE, g.matchId);
  const ins = db.prepare(
    "INSERT INTO events (game_id, timestamp, event_type, round, key, data, created_at, feature, category) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  let done = 0;
  return {
    file,
    push(dt) {
      for (const r of fixture.rows.filter((x) => x.dt <= dt).slice(done)) {
        ins.run(
          g.id,
          BASE + r.dt,
          r.event_type,
          r.round ?? "0-0",
          r.key,
          r.data,
          BASE + r.dt,
          r.feature,
          r.feature,
        );
        done++;
      }
    },
    close: () => db.close(),
  };
}

const hubWith = ({ gep, gameFiles = noGameFiles }) =>
  createStateHub({ gameFiles, gep });

/** O que importa de cada leitura: valores, a origem de cada campo e a do `GameState`. */
const brief = (hub, s) => ({
  gold: s.gold ?? null,
  level: s.level ?? null,
  xp: s.xp ?? null,
  stage: s.stage ?? null,
  shop: s.shop?.map((c) => c?.id ?? null) ?? null,
  items: s.items ?? null,
  removers: s.removers ?? null,
  wisps: s.wisps ?? null,
  augments: s.augments ?? null,
  sources: {
    gold: s.sources?.gold ?? null,
    level: s.sources?.level ?? null,
    xp: s.sources?.xp ?? null,
    stage: s.sources?.stage ?? null,
    shop: s.sources?.shop ?? null,
    items: s.sources?.items ?? null,
    bench: s.sources?.bench ?? null,
  },
  gep: s.gepStatus?.state ?? null,
  state: Object.fromEntries(
    Object.entries(hub.gameState(s, GAME_ID).me).map(([k, f]) => [k, f.source]),
  ),
});

const none = {
    gold: null,
    level: null,
    xp: null,
    stage: null,
    shop: null,
    items: null,
    bench: null,
  },
  fromGep = (...names) => Object.fromEntries(names.map((n) => [n, "gep"])),
  meNone = {
    gold: null,
    level: null,
    xp: null,
    shop: null,
    itemBank: null,
    removers: null,
    bench: null,
    wisps: null,
    pickedAugments: null,
    augmentOffer: null,
  };

// Partida gravada (fixture, 58 s): o que o estado mostra a cada instante, sem tela. Documenta a lacuna do início (L1):
// ouro, nível, XP e loja só aparecem com o primeiro evento deles (48 s); o banco de itens espera a identidade local (1 s).
const TIMELINE = [
  {
    dt: 0,
    gold: null,
    level: null,
    xp: null,
    stage: null,
    shop: null,
    items: null,
    removers: null,
    wisps: null,
    noSource: {
      gold: "aguardando-gep",
      level: "aguardando-gep",
      xp: "aguardando-gep",
      shop: "aguardando-gep",
      items: "identidade-desconhecida",
      wisps: "aguardando-gep",
      augments: "aguardando-gep",
    },
    sources: { ...none, ...fromGep("bench") },
    state: { ...meNone, bench: "gep" },
  },
  {
    dt: 1,
    gold: null,
    level: null,
    xp: null,
    stage: "1-1",
    shop: null,
    items: [],
    removers: 0,
    wisps: null,
    noSource: {
      gold: "aguardando-gep",
      level: "aguardando-gep",
      xp: "aguardando-gep",
      shop: "aguardando-gep",
      wisps: "aguardando-gep",
      augments: "aguardando-gep",
    },
    sources: { ...none, ...fromGep("stage", "items", "bench") },
    state: {
      ...meNone,
      ...fromGep("itemBank", "removers", "bench"),
    },
  },
  {
    dt: 20,
    gold: null,
    level: null,
    xp: null,
    stage: "1-2",
    shop: null,
    items: [],
    removers: 0,
    wisps: null,
    noSource: {
      gold: "aguardando-gep",
      level: "aguardando-gep",
      xp: "aguardando-gep",
      shop: "aguardando-gep",
      wisps: "aguardando-gep",
      augments: "aguardando-gep",
    },
    sources: { ...none, ...fromGep("stage", "items", "bench") },
    state: {
      ...meNone,
      ...fromGep("itemBank", "removers", "bench"),
    },
  },
  {
    dt: 47,
    gold: null,
    level: null,
    xp: null,
    stage: "1-2",
    shop: null,
    items: [],
    removers: 2,
    wisps: null,
    noSource: {
      gold: "aguardando-gep",
      level: "aguardando-gep",
      xp: "aguardando-gep",
      shop: "aguardando-gep",
      wisps: "aguardando-gep",
      augments: "aguardando-gep",
    },
    sources: { ...none, ...fromGep("stage", "items", "bench") },
    state: {
      ...meNone,
      ...fromGep("itemBank", "removers", "bench"),
    },
  },
  {
    dt: 48,
    gold: 2,
    level: 2,
    xp: "0/2",
    stage: "1-3",
    shop: [
      "DA_18_Sentry",
      "DA_18_Rakan",
      "DA_18_Kobuko",
      "DA_18_RekSai",
      "DA_18_Akali_AD",
    ],
    items: [],
    removers: 2,
    wisps: [],
    noSource: { augments: "aguardando-gep" },
    sources: fromGep("gold", "level", "xp", "stage", "shop", "items", "bench"),
    state: {
      ...meNone,
      ...fromGep(
        "gold",
        "level",
        "xp",
        "shop",
        "itemBank",
        "removers",
        "bench",
        "wisps",
      ),
    },
  },
  {
    dt: 58,
    gold: 0,
    level: 2,
    xp: "0/2",
    stage: "1-3",
    shop: [null, null, "DA_18_Kobuko", "DA_18_RekSai", "DA_18_Akali_AD"],
    items: [],
    removers: 2,
    wisps: [],
    noSource: { augments: "aguardando-gep" },
    sources: fromGep("gold", "level", "xp", "stage", "shop", "items", "bench"),
    state: {
      ...meNone,
      ...fromGep(
        "gold",
        "level",
        "xp",
        "shop",
        "itemBank",
        "removers",
        "bench",
        "wisps",
      ),
    },
  },
];

/** Repassa a partida gravada pelo montador; devolve cada leitura `{ dt, seen }` (o mesmo montador do começo ao fim). */
function replay(points = TIMELINE.map((p) => p.dt)) {
  const match = recordedMatch(),
    clock = { t: 0 },
    hub = hubWith({
      gep: gepReader({
        file: match.file,
        now: () => clock.t,
        champions: new Set(catalog.champions.map((c) => c.apiName)),
        items: new Set(catalog.items.map((i) => i.apiName)),
        minIntervalMs: 0,
      }),
    });
  try {
    return points.map((dt) => {
      match.push(dt);
      clock.t = (BASE + dt + 1) * 1000;
      return { dt, hub, seen: hub.seen(GAME_ID, ctx) };
    });
  } finally {
    match.close();
  }
}

test("partida gravada sem tela: cada campo vem do GEP ou fica desconhecido, nunca da tela", () => {
  const got = replay();
  for (const [i, want] of TIMELINE.entries()) {
    const { dt, hub, seen } = got[i],
      b = brief(hub, seen);
    assert.equal(dt, want.dt);
    assert.equal(b.gep, "ativo", `${dt}s`);
    for (const key of [
      "gold",
      "level",
      "xp",
      "stage",
      "shop",
      "items",
      "removers",
      "wisps",
    ])
      assert.deepEqual(b[key], want[key], `${dt}s: ${key}`);
    assert.equal(b.augments, null, `${dt}s: sem evento de aprimoramento`);
    assert.deepEqual(b.sources, want.sources, `${dt}s: sources`);
    // Desconhecido explícito: cada campo sem valor diz por quê (L1: nenhum evento ainda; banco sem identidade local).
    assert.deepEqual(seen.noSource, want.noSource, `${dt}s: noSource`);
    assert.deepEqual(b.state, want.state, `${dt}s: GameState`);
    assert.doesNotMatch(
      JSON.stringify(seen.sources),
      /"screen"/,
      `${dt}s: nenhuma origem "screen"`,
    );
  }
});

test("GEP ausente ou obsoleto, sem tela: ouro, XP, loja e itens desconhecidos; nível só como piso derivado do estágio", () => {
  for (const gepNow of [
    { available: false, state: "ausente", reason: "banco-ausente" },
    { available: false, state: "obsoleto", reason: "sem-eventos-recentes" },
  ]) {
    const hub = hubWith({
        gep: { status: () => gepNow },
        gameFiles: sentryAt("3-2"),
      }),
      seen = hub.seen(GAME_ID, ctx),
      state = hub.gameState(seen, GAME_ID);
    assert.equal(seen.gepStatus.state, gepNow.state);
    for (const key of ["gold", "xp", "shop", "items", "removers", "wisps"])
      assert.equal(seen[key] ?? null, null, `${gepNow.state}: ${key}`);
    assert.equal(seen.level, levelFloor("3-2"));
    assert.equal(seen.sources.level, "derived");
    assert.equal(seen.levelInfo.minimum, true);
    assert.equal(seen.stage, "3-2");
    assert.equal(seen.sources.stage, "game-log");
    assert.equal(seen.sources.bench, null);
    assert.equal(seen.augments, null);
    assert.equal(seen.augmentSource.state, "sem-fonte");
    for (const key of [
      "gold",
      "xp",
      "shop",
      "itemBank",
      "removers",
      "bench",
      "wisps",
      "augmentOffer",
    ])
      assert.deepEqual(
        [state.me[key].value, state.me[key].source],
        [null, null],
        `${gepNow.state}: me.${key}`,
      );
    assert.equal(state.me.level.source, "derived");
    assert.equal(state.clock.stage.source, "sentry");
  }
  // No estágio 1 o XP passivo ainda não dá piso: o nível também é desconhecido.
  const early = hubWith({
    gep: { status: () => ({ available: false, state: "ausente" }) },
    gameFiles: sentryAt("1-3"),
  }).seen(GAME_ID, ctx);
  assert.equal(early.level, null);
  assert.equal(early.sources.level, null);
});

test("lacunas do GEP sem tela: loja escondida, banco sem identidade local e GEP fora ficam desconhecidos com o motivo", () => {
  const match = recordedMatch();
  match.push(58);
  match.close();
  const read = (local) =>
      gepReader({
        file: match.file,
        now: () => (BASE + 59) * 1000,
        champions: new Set(catalog.champions.map((c) => c.apiName)),
        items: new Set(catalog.items.map((i) => i.apiName)),
        minIntervalMs: 0,
      }).status({ ...ctx, local }),
    seenWith = (gepNow) =>
      hubWith({ gep: { status: () => gepNow } }).seen(GAME_ID, ctx);
  // L2: loja escondida (shop_visible falso) não vira a loja de antes nem a da tela: desconhecida.
  const hidden = structuredClone(read(fixture.local));
  hidden.fields.shop.visible = false;
  const shopHidden = seenWith(hidden);
  assert.equal(shopHidden.shop ?? null, null);
  assert.equal(shopHidden.sources.shop ?? null, null);
  assert.equal(shopHidden.noSource.shop, "loja-escondida");
  assert.equal(shopHidden.gold, 0, "o resto continua vindo do GEP");
  // L4: banco de itens de outro jogador (identidade divergente): desconhecido, nunca o banco vazio.
  const other = seenWith(read({ name: "Outra", tag: "Z" })),
    hub = hubWith({ gep: { status: () => null } });
  assert.equal(other.items ?? null, null);
  assert.equal(other.removers ?? null, null);
  assert.equal(other.noSource.items, "identidade-divergente");
  assert.equal(
    hub.gameState(other, GAME_ID).me.itemBank.reason,
    "identidade-divergente",
  );
  // GEP fora: o motivo é o da fonte, em cada campo do jogador.
  const off = seenWith({
    available: false,
    state: "ausente",
    reason: "banco-ausente",
  });
  assert.deepEqual(off.noSource, {
    gold: "banco-ausente",
    level: "banco-ausente",
    xp: "banco-ausente",
    shop: "banco-ausente",
    items: "banco-ausente",
    bench: "banco-ausente",
    wisps: "banco-ausente",
    augments: "banco-ausente",
  });
  assert.equal(hub.gameState(off, GAME_ID).me.gold.reason, "banco-ausente");
});

test("GEP ausente: o chip da interface diz 'GEP off · sem fonte' e lista o que ficou desconhecido", () => {
  const seen = hubWith({
      gep: {
        status: () => ({
          available: false,
          state: "ausente",
          reason: "banco-ausente",
        }),
      },
      gameFiles: sentryAt("3-2"),
    }).seen(GAME_ID, ctx),
    { status } = buildModel({
      state: { seen, gepStatus: seen.gepStatus },
      rec: null,
    });
  assert.equal(status.gep.state, "ausente");
  assert.equal(status.gep.short, "GEP off · sem fonte");
  // O nível tem o piso derivado do estágio (3-2): não está na lista.
  assert.deepEqual(status.gep.missing, [
    "ouro",
    "XP",
    "loja",
    "itens",
    "aprimoramentos",
  ]);
  assert.match(
    status.gep.label,
    /Sem fonte: ouro, XP, loja, itens, aprimoramentos/,
  );
  assert.match(status.gep.label, /Overwolf com o TFTAcademy/);
  assert.doesNotMatch(status.gep.label, /tela/);
});

/* ---------- Chave de análise: cópia congelada da regra de core/state/analysis-key.mjs em 2026-10-11 ---------- */
const frozenKey = (state, payload, now) =>
  JSON.stringify({
    payload,
    source: state.signature ?? state.modifiedAt,
    phase: state.phase,
    actionable: state.actionable,
    sameGame: state.sameGame,
    match: state.match?.id,
    screen: {
      xp: state.screen?.xp,
      stage: state.screen?.stage,
      shop: state.screen?.shop,
      augments: state.screen?.augments,
      pickedAugments: state.screen?.pickedAugments,
      removers: state.screen?.removers,
      gold: state.screen?.gold,
      level: state.screen?.level,
      levelSource: state.screen?.sources?.level,
      items: state.screen?.items,
      bench: state.screen?.gepBench,
    },
    estimatedLevel: state.screen?.level == null ? state.estimatedLevel : null,
    window: Math.floor(now / REFRESH_WINDOW_MS),
  });

test("chave de análise dos estados só com o GEP é a mesma da regra congelada (o estado em `seen` dá a chave de `screen`)", () => {
  const base = JSON.parse(
      fs.readFileSync(
        new URL("../live-mock-base.json", import.meta.url),
        "utf8",
      ),
    ).state,
    now = 15_000_000 * REFRESH_WINDOW_MS + 1234,
    bodies = [
      base,
      ...replay().map(({ seen }) => {
        const { gepStatus: _gepStatus, ...rest } = seen;
        return { ...base, seen: rest };
      }),
      { ...base, seen: undefined },
    ];
  for (const body of bodies) {
    const payload = decisionPayload(body, { goalCompId: "X" });
    // O estado visto está em `seen` (P3); a regra congelada o lia em `screen`: a chave não muda.
    assert.equal(
      analysisKey(body, payload, now),
      frozenKey({ ...body, screen: body.seen }, payload, now),
    );
  }
});
