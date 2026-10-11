// Rodar com: node --test tft/helper/overwolf-bridge/test/
// Verifica a ponte de ponta a ponta no que e possivel sem o Overwolf: mensagens GEP no formato documentado -> filtro de
// privacidade -> SQLite proprio -> gep-reader.mjs do helper (o consumidor real). O pacote `gep` do ow-electron em si NAO e
// exercitado aqui (exige o Overwolf, conta e credenciais): ver README.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { gepReader } from "../../gep-reader.mjs";

const require = createRequire(import.meta.url);
const {
  createRecorder,
  matchIdFromCommandLine,
} = require("../src/recorder.cjs");
const { sanitize } = require("../src/sanitize.cjs");
const {
  FEATURES,
  isTftGameId,
  toConfiguredGameId,
} = require("../src/features.cjs");
const { GepService } = require("../src/gep-service.cjs");
const { createForwarder } = require("../src/forward.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tft-bridge-"));
const info = (feature, key, value) => ({
  feature,
  category: feature,
  key,
  value,
});
const ME = { name: "Eu", tag: "BR1" };
const roster = {
  Eu: {
    index: 1,
    health: 100,
    xp: 2,
    localplayer: true,
    rank: 0,
    tag_line: "BR1",
  },
  Rival: {
    index: 2,
    health: 80,
    xp: 4,
    localplayer: false,
    rank: 0,
    tag_line: "BR1",
  },
};
const itemBench = [
  {
    summoner: "Rival",
    tag_line: "BR1",
    bench_items: [{ name: "TFT_Item_BFSword", count: 3 }],
  },
  {
    summoner: "Eu",
    tag_line: "BR1",
    bench_items: [{ name: "TFT_Item_NeedlesslyLargeRod", count: 2 }],
  },
];

function session(clock = { t: 1_800_000_000_000 }) {
  const dir = tmp();
  const file = path.join(dir, "tft-events.db");
  const rec = createRecorder({ file, now: () => clock.t });
  return { dir, file, rec, clock };
}

test("filtro: so o jogador local; rivais e aprimoramentos nunca chegam ao banco", () => {
  assert.equal(
    sanitize("info", info("board", "opponent_board_pieces", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("match_stats", "board_players", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("match_info", "battle_stats", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("match_info", "round_outcome", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("match_info", "opponent", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("live_client_data", "all_players", "[]")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("augments", "me", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(
    sanitize("info", info("augments", "picked_augment", "{}")).drop,
    "fora-da-lista",
  );
  assert.equal(sanitize("info", { key: "gold" }).drop, "fora-da-lista");
  assert.equal(
    sanitize("info", info("me", "gold", "{bad")).drop,
    "json-invalido",
  );
  assert.equal(sanitize("info", null).drop, "malformada");
  assert.ok(
    !FEATURES.includes("augments") &&
      !FEATURES.includes("board") &&
      !FEATURES.includes("match_stats"),
  );
  // roster: so a linha local; sem jogador local, nada
  const r = sanitize(
    "info",
    info("roster", "player_status", JSON.stringify(roster)),
  );
  assert.deepEqual(Object.keys(r.record.value), ["Eu"]);
  assert.deepEqual(r.identity, ME);
  assert.equal(
    sanitize(
      "info",
      info("roster", "player_status", JSON.stringify({ Rival: roster.Rival })),
    ).drop,
    "roster-sem-jogador-local",
  );
  // item_bench: sem identidade espera (so em memoria); com identidade, so a linha local
  assert.equal(
    sanitize("info", info("bench", "item_bench", JSON.stringify(itemBench)))
      .pending,
    "item_bench",
  );
  const b = sanitize(
    "info",
    info("bench", "item_bench", JSON.stringify(itemBench)),
    ME,
  );
  assert.equal(b.record.value.length, 1);
  assert.equal(b.record.value[0].summoner, "Eu");
});

test("ids de jogo: classe, sufixo e UE5", () => {
  assert.ok(
    isTftGameId(21570) &&
      isTftGameId(215701) &&
      isTftGameId(28164) &&
      isTftGameId(281641),
  );
  assert.ok(!isTftGameId(5426) && !isTftGameId(10902));
  assert.equal(toConfiguredGameId(215701), 21570);
  assert.equal(
    matchIdFromCommandLine("TFT.exe -GameId=3282025760 -PlatformID=br1 -x"),
    "BR1_3282025760",
  );
  assert.equal(matchIdFromCommandLine("TFT.exe"), null);
});

test("ponta a ponta: mensagens GEP -> SQLite proprio -> gep-reader do helper", () => {
  const { file, rec, clock } = session();
  rec.gameDetected({ commandLine: "TFT -GameId=1000000001 -PlatformID=BR1" });
  const feed = (kind, i) => rec.handle(kind, i);
  feed("event", { key: "match_start", value: null });
  feed(
    "info",
    info("match_info", "match_state", JSON.stringify({ in_progress: true })),
  );
  feed("info", info("roster", "player_status", JSON.stringify(roster)));
  feed("info", info("bench", "item_bench", JSON.stringify(itemBench)));
  feed(
    "info",
    info(
      "match_info",
      "round_type",
      JSON.stringify({ stage: "2-1", name: "PVP", type: "PVP" }),
    ),
  );
  feed("info", info("me", "gold", "37"));
  feed(
    "info",
    info("me", "xp", JSON.stringify({ level: 6, current_xp: 4, xp_max: 36 })),
  );
  feed(
    "info",
    info(
      "store",
      "shop_pieces",
      JSON.stringify({
        slot_1: { name: "TFT18_Jinx" },
        slot_2: { name: "Sold" },
      }),
    ),
  );
  feed(
    "info",
    info(
      "bench",
      "bench_pieces",
      JSON.stringify({
        cell_1: { name: "TFT18_Jinx", level: 2, item_1: "TFT_Item_BFSword" },
      }),
    ),
  );
  // lixo que nunca pode entrar
  const dropped = feed(
    "info",
    info(
      "board",
      "opponent_board_pieces",
      JSON.stringify({ cell_1: { name: "X" } }),
    ),
  );
  assert.equal(dropped.stored, false);
  const aug = feed(
    "info",
    info("augments", "me", JSON.stringify({ augment_1: { name: "A" } })),
  );
  assert.equal(aug.stored, false);

  // o que foi gravado nao contem rival nem aprimoramento
  const { DatabaseSync } = require("node:sqlite");
  const raw = new DatabaseSync(file, { readOnly: true });
  const all = raw.prepare("SELECT feature, key, data FROM events").all();
  raw.close();
  const text = JSON.stringify(all);
  assert.ok(
    !text.includes("Rival") &&
      !text.includes("opponent") &&
      !text.includes("augment"),
  );
  assert.ok(!text.includes('TFT_Item_BFSword","count":3'));

  const reader = gepReader({
    file,
    now: () => clock.t + 5_000,
    minIntervalMs: 0,
  });
  const st = reader.status({ gameId: "1000000001", inMatch: true });
  assert.equal(st.state, "ativo");
  assert.equal(st.binding, "match_id");
  assert.equal(st.fields.gold.value, 37);
  assert.equal(st.fields.level.value, 6);
  assert.equal(st.fields.xp.value, "4/36");
  assert.equal(st.fields.stage.value, "2-1");
  assert.equal(st.identity, "confirmada");
  assert.deepEqual(st.fields.items.bank, [
    "TFT_Item_NeedlesslyLargeRod",
    "TFT_Item_NeedlesslyLargeRod",
  ]);
  assert.equal(st.fields.shop.value[0].id, "TFT18_Jinx");
  assert.equal(st.fields.bench.value[0].stars, 2);
  assert.equal(st.recordGames, true);

  // fim da partida: o helper ve "encerrada"; evento atrasado nao abre partida nova
  feed("event", { key: "match_end", value: null });
  assert.equal(feed("info", info("me", "gold", "9")).stored, false);
  const after = gepReader({
    file,
    now: () => clock.t + 6_000,
    minIntervalMs: 0,
  }).status({});
  assert.equal(after.reason, "partida-encerrada");
  rec.close();
});

test("item_bench que chega antes do roster so e gravado depois da identidade", () => {
  const { file, rec, clock } = session();
  rec.handle("info", info("me", "gold", "5"));
  assert.equal(
    rec.handle("info", info("bench", "item_bench", JSON.stringify(itemBench)))
      .reason,
    "aguardando-identidade",
  );
  rec.handle("info", info("roster", "player_status", JSON.stringify(roster)));
  const st = gepReader({
    file,
    now: () => clock.t + 1_000,
    minIntervalMs: 0,
  }).status({});
  assert.equal(st.fields.items.bank.length, 2);
  rec.close();
});

test("precedencia: ponte propria > TFTAcademy; sem a propria cai para o TFTAcademy", () => {
  const dir = tmp();
  const own = path.join(dir, "own.db"),
    academy = path.join(dir, "academy.db");
  const clock = { t: 1_800_000_000_000 };
  const feedGold = (file, gold) => {
    const r = createRecorder({ file, now: () => clock.t });
    r.handle("info", info("me", "gold", String(gold)));
    r.close();
  };
  feedGold(academy, 11);
  const prevOwn = process.env.TFT_BRIDGE_DB,
    prevAcademy = process.env.TFT_GEP_DB;
  delete process.env.TFT_GEP_DB;
  process.env.TFT_BRIDGE_DB = own; // ainda nao existe
  const prevAppData = process.env.APPDATA;
  try {
    // defaultGepDb() olha APPDATA\TFTAcademy: monta a pasta do teste no lugar
    process.env.APPDATA = path.join(dir, "appdata");
    fs.mkdirSync(path.join(process.env.APPDATA, "TFTAcademy"), {
      recursive: true,
    });
    fs.copyFileSync(
      academy,
      path.join(process.env.APPDATA, "TFTAcademy", "tft-events.db"),
    );
    const mk = () =>
      gepReader({ now: () => clock.t + 2_000, minIntervalMs: 0 });
    const only = mk().status({});
    assert.equal(only.origin, "tftacademy");
    assert.equal(only.fields.gold.value, 11);
    feedGold(own, 22);
    const both = mk().status({});
    assert.equal(both.origin, "proprio");
    assert.equal(both.fields.gold.value, 22);
    assert.deepEqual(
      both.origins.map((o) => o.origin),
      ["proprio"],
    ); // a segunda nao e lida se a primeira esta ativa
    // propria velha (obsoleta) e TFTAcademy fresca: vale a fresca
    clock.t += 120_000;
    const fresh = createRecorder({
      file: path.join(process.env.APPDATA, "TFTAcademy", "tft-events.db"),
      now: () => clock.t,
    });
    fresh.handle("info", info("me", "gold", "33"));
    fresh.close();
    const stale = gepReader({
      now: () => clock.t + 1_000,
      minIntervalMs: 0,
    }).status({});
    assert.equal(stale.origin, "tftacademy");
    assert.equal(stale.fields.gold.value, 33);
    assert.equal(stale.origins[0].state, "obsoleto");
  } finally {
    for (const [k, v] of [
      ["TFT_BRIDGE_DB", prevOwn],
      ["TFT_GEP_DB", prevAcademy],
      ["APPDATA", prevAppData],
    ])
      v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
});

test("GepService: e.enable(), features pedidas e mensagens so do TFT", async () => {
  const handlers = {};
  const calls = [];
  const gep = {
    removeAllListeners() {},
    on(name, fn) {
      handlers[name] = fn;
    },
    async setRequiredFeatures(id, features) {
      calls.push([id, features]);
    },
  };
  const pkgHandlers = {};
  const overwolf = {
    packages: {
      gep: null,
      on(n, fn) {
        pkgHandlers[n] = fn;
      },
    },
  };
  const svc = new GepService(overwolf);
  const seen = [];
  svc.on("message", (k, i) => seen.push([k, i.key]));
  svc.start();
  overwolf.packages.gep = gep;
  pkgHandlers.ready({}, "gep", "1.0");
  let enabled = 0;
  handlers["game-detected"]({ enable: () => enabled++ }, 215701, "TFT", {
    pid: 1,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(enabled, 1);
  assert.deepEqual(calls[0], [21570, [...FEATURES]]);
  handlers["game-detected"]({ enable: () => enabled++ }, 5426, "League", {});
  assert.equal(enabled, 1);
  handlers["new-info-update"]({}, 215701, { key: "gold" });
  handlers["new-game-event"]({}, 5426, { key: "x" });
  assert.deepEqual(seen, [["info", "gold"]]);
});

test("encaminhamento so aceita destino local", () => {
  assert.equal(createForwarder(""), null);
  assert.throws(() => createForwarder("http://example.com/x"));
  assert.throws(() => createForwarder("https://127.0.0.1/x"));
  assert.equal(
    typeof createForwarder("http://127.0.0.1:3218/gep", async () => ({})),
    "function",
  );
});
