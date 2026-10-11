// Rodar com: node --test "tft/helper/tests/*.test.mjs"
// Carrossel no estado: detecção (fase do jogo, GEP, calendário), leitura das peças do GEP (`carousel_pieces`), bloco do
// /api/state (leitura x lista de prioridade) e o caminho do banco do TFTAcademy até o corpo do estado. Os payloads são os
// que o GEP gravou de verdade (partidas de 2026-10-10/11 no banco do TFTAcademy); o plano é o da captura real de
// `live-mock-base.json`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { carouselView, carouselFeed } from "../app/carousel-view.mjs";
import {
  carouselSignals,
  currentOffer,
  detectCarousel,
  isCarouselRound,
} from "../core/state/carousel.mjs";
import { createOverlayFeed } from "../app/overlay-feed.mjs";
import { createStateHub } from "../app/state.mjs";
import {
  applyGepEvent,
  emptyGepState,
  gepReader,
  mergeGep,
  parseCarouselPieces,
} from "../gep-reader.mjs";
import { mergeSources } from "../game-log.mjs";

const catalog = JSON.parse(
  fs.readFileSync(new URL("../catalog.json", import.meta.url), "utf8"),
);
const champions = new Set(catalog.champions.map((c) => c.apiName)),
  items = new Set(catalog.items.map((i) => i.apiName));
const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);

/** `carousel_pieces` de 2-4 como o GEP gravou (3 componentes entre as 13 peças; o resto está no banco real). */
const PIECES_2_4 = JSON.stringify({
  slot_1: {
    name: "DA_18_MasterYi_AD",
    item_1: "DA_Component_RecurveBow",
    item_2: "",
  },
  slot_2: {
    name: "DA_18_Varus",
    item_1: "DA_Component_NegatronCloak",
    item_2: "",
  },
  slot_3: { name: "DA_Gromp18_AP", item_1: "DA_Component_Spatula", item_2: "" },
  slot_4: {
    name: "DA_18_Veigar",
    item_1: "DA_Component_NeedlesslyLargeRod",
    item_2: "",
  },
  slot_5: {
    name: "DA_18_Aphelios",
    item_1: "DA_Component_BFSword",
    item_2: "",
  },
  slot_6: {
    name: "DA_18_Alistar",
    item_1: "DA_Component_ChainVest",
    item_2: "",
  },
});
/** `carousel_pieces` de 5-4 (item completo e emblemas, não componentes). */
const PIECES_5_4 = JSON.stringify({
  slot_1: { name: "DA_Krug18", item_1: "DA_18_EmblemLunar", item_2: "" },
  slot_2: { name: "DA_18_Morgana", item_1: "DA_VoidStaff", item_2: "" },
  slot_3: { name: "DA_18_Aphelios", item_1: "DA_ProtectorsVow", item_2: "" },
  slot_4: { name: "DA_18_Zyra", item_1: "DA_SunfireCape", item_2: "" },
});

/* ---------- Detecção ---------- */

test("calendário: carrossel é a x-4 a partir do estágio 2; a 1-1 é Encounter, não carrossel", () => {
  for (const s of ["2-4", "3-4", "4-4", "5-4", "6-4"])
    assert.equal(isCarouselRound(s), true, s);
  for (const s of ["1-1", "1-4", "2-3", "2-5", "3-7", "4-1", null, "x", ""])
    assert.equal(isCarouselRound(s), false, String(s));
});

test("detecção: a fase do jogo vence o GEP, que vence o calendário; cada fonte aparece em 'source'", () => {
  const log = detectCarousel({ stage: "2-4", phaseKind: "draft" });
  assert.deepEqual(
    [log.active, log.source, log.confidence, log.stage, log.round],
    [true, "game-log", "observed", "2-4", 4],
  );
  const gep = detectCarousel({
    stage: "3-4",
    gepRound: { stage: "3-4", name: "Carousel" },
  });
  assert.deepEqual(
    [gep.active, gep.source, gep.confidence],
    [true, "gep", "observed"],
  );
  const calendar = detectCarousel({ stage: "4-4" });
  assert.deepEqual(
    [calendar.active, calendar.source, calendar.confidence],
    [true, "schedule", "estimated"],
  );
  // Fase do jogo diz que NÃO é carrossel: vale mesmo na x-4 do calendário, e o conflito fica registrado.
  const planning = detectCarousel({ stage: "2-4", phaseKind: "planning" });
  assert.deepEqual([planning.active, planning.source], [false, "game-log"]);
  assert.equal(planning.conflict, true);
  // Sinais que concordam não são conflito.
  assert.equal(
    detectCarousel({
      stage: "2-4",
      phaseKind: "draft",
      gepRound: { stage: "2-4", name: "Carousel" },
    }).conflict,
    false,
  );
});

test("detecção: sem estágio nem fase nem GEP o carrossel é desconhecido (null), nunca 'não'", () => {
  const none = detectCarousel({});
  assert.deepEqual(
    [
      none.active,
      none.source,
      none.confidence,
      none.stage,
      none.round,
      none.conflict,
    ],
    [null, null, null, null, null, false],
  );
  assert.equal(detectCarousel().active, null);
  assert.equal(detectCarousel({ stage: "lixo" }).active, null);
});

test("detecção: round_type do GEP de OUTRA rodada não vale (atraso do GEP), e nome diferente de Carousel diz que não é", () => {
  assert.equal(
    carouselSignals({
      stage: "2-5",
      gepRound: { stage: "2-4", name: "Carousel" },
    }).gep,
    null,
  );
  assert.equal(
    carouselSignals({ stage: "2-5", gepRound: { stage: "2-5", name: "PVP" } })
      .gep,
    false,
  );
  // Sem estágio conhecido, o GEP vale por si.
  assert.equal(
    detectCarousel({ gepRound: { stage: "2-4", name: "Carousel" } }).active,
    true,
  );
  assert.equal(
    detectCarousel({ gepRound: { stage: "2-4", name: "carousel " } }).active,
    true,
    "caixa e espaço não importam",
  );
});

test("oferta do GEP: só vale na rodada em que foi lida (o GEP não apaga a do carrossel anterior)", () => {
  const offer = {
    stage: "2-4",
    slots: [{ slot: 1, id: "DA_18_Aphelios", item: "DA_Component_BFSword" }],
  };
  assert.equal(currentOffer(offer, { stage: "2-4" }), offer);
  assert.equal(currentOffer(offer, { stage: "2-5" }), null);
  assert.equal(currentOffer(offer, { stage: "3-4" }), null);
  assert.equal(
    currentOffer({ ...offer, stage: null }, { stage: "2-4" }),
    null,
    "oferta sem rodada",
  );
  assert.equal(
    currentOffer(offer, { stage: null }),
    null,
    "sem rodada atual e sem o GEP dizer carrossel",
  );
  assert.equal(
    currentOffer(offer, { stage: null, gepRound: { name: "Carousel" } }),
    offer,
  );
  assert.equal(
    currentOffer({ stage: "2-4", slots: [] }, { stage: "2-4" }),
    null,
  );
  assert.equal(currentOffer(null, { stage: "2-4" }), null);
});

/* ---------- Leitura do GEP ---------- */

test("parseCarouselPieces: campeão e item de cada peça, na ordem; fora do catálogo vira desconhecido com o texto", () => {
  const ok = parseCarouselPieces(
    PIECES_2_4,
    (n) => champions.has(n),
    (n) => items.has(n),
  );
  assert.equal(ok.slots.length, 6);
  assert.deepEqual(ok.slots[4], {
    slot: 5,
    id: "DA_18_Aphelios",
    text: "DA_18_Aphelios",
    item: "DA_Component_BFSword",
    itemText: "DA_Component_BFSword",
    items: ["DA_Component_BFSword"],
  });
  assert.equal(ok.unknown, 0);
  const odd = parseCarouselPieces(
    JSON.stringify({
      slot_2: {
        name: "DA_18_Aphelios",
        item_1: "DA_ItemQueNaoExiste",
        item_2: "",
      },
      slot_1: {
        name: "DA_Campeao_Novo",
        item_1: "DA_Component_BFSword",
        item_2: "",
      },
    }),
    (n) => champions.has(n),
    (n) => items.has(n),
  );
  assert.deepEqual(
    odd.slots.map((s) => s.slot),
    [1, 2],
    "ordenadas pelo número do espaço",
  );
  assert.equal(odd.slots[0].id, null);
  assert.equal(odd.slots[0].text, "DA_Campeao_Novo");
  assert.equal(odd.slots[1].item, null);
  assert.equal(odd.slots[1].itemText, "DA_ItemQueNaoExiste");
  assert.equal(odd.unknown, 2);
  // Carrossel sem peças, JSON inválido e formas estranhas.
  assert.deepEqual(parseCarouselPieces("{}"), { slots: [], unknown: 0 });
  assert.equal(parseCarouselPieces("lixo"), null);
  assert.equal(parseCarouselPieces("[1]"), null);
  assert.equal(parseCarouselPieces(undefined), null);
  assert.deepEqual(
    parseCarouselPieces('{"slot_1":{"name":""},"x":1}').slots,
    [],
  );
});

test("reducer: a oferta fica com a rodada do evento e só o próximo carrossel a troca", () => {
  const env = {
    isChampion: (n) => champions.has(n),
    isItem: (n) => items.has(n),
  };
  const state = emptyGepState();
  applyGepEvent(
    state,
    {
      id: 1,
      ts: 10,
      feature: "match_info",
      key: "round_type",
      round: "2-4",
      data: '{"stage":"2-4","name":"Carousel"}',
    },
    env,
  );
  applyGepEvent(
    state,
    {
      id: 2,
      ts: 10,
      feature: "carousel",
      key: "carousel_pieces",
      round: "2-4",
      data: PIECES_2_4,
    },
    env,
  );
  assert.equal(state.carousel.stage, "2-4");
  assert.equal(state.carousel.value.length, 6);
  // O round_type seguinte não apaga a oferta (o GEP também não); quem confere a rodada é o estado.
  applyGepEvent(
    state,
    {
      id: 3,
      ts: 50,
      feature: "match_info",
      key: "round_type",
      round: "2-5",
      data: '{"stage":"2-5","name":"PVP"}',
    },
    env,
  );
  assert.equal(state.carousel.stage, "2-4");
  // Sem a coluna `round`, vale a rodada do último round_type.
  applyGepEvent(
    state,
    {
      id: 4,
      ts: 300,
      feature: "match_info",
      key: "round_type",
      data: '{"stage":"3-4","name":"Carousel"}',
    },
    env,
  );
  applyGepEvent(
    state,
    {
      id: 5,
      ts: 300,
      feature: "carousel",
      key: "carousel_pieces",
      data: PIECES_5_4,
    },
    env,
  );
  assert.equal(state.carousel.stage, "3-4");
  assert.equal(state.carousel.value[0].item, "DA_18_EmblemLunar");
  // Carrossel de outra feature com a mesma chave não entra.
  const before = state.carousel;
  applyGepEvent(
    state,
    {
      id: 6,
      ts: 301,
      feature: "outra",
      key: "carousel_pieces",
      data: PIECES_2_4,
    },
    env,
  );
  assert.equal(state.carousel, before);
});

/** Banco no esquema do TFTAcademy com uma partida em andamento; devolve o caminho. */
function makeDb(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-test-"));
  const file = path.join(dir, "tft-events.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE games (id text PRIMARY KEY NOT NULL, started_at integer NOT NULL, ended_at integer, game_version text,
      set_number real, player_puuid text, final_placement integer, queue_type integer, created_at integer NOT NULL, match_id text);
    CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, game_id text NOT NULL, timestamp integer NOT NULL,
      event_type text NOT NULL, player_id text, round text, stage_type text, key text, data text, created_at integer NOT NULL,
      feature text, category text);`);
  db.prepare(
    "INSERT INTO games (id, started_at, ended_at, set_number, queue_type, created_at, match_id) VALUES (?,?,?,?,?,?,?)",
  ).run("g1", 1000, null, 18, 1100, 1000, "BR1_4000000001");
  const ins = db.prepare(
    "INSERT INTO events (game_id, timestamp, event_type, round, key, data, created_at, feature) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const r of rows)
    ins.run(
      "g1",
      r.ts,
      r.type ?? "match_info",
      r.round,
      r.key,
      r.data,
      r.ts,
      r.feature,
    );
  db.close();
  return file;
}

test("GEP do banco real: round_type e carousel_pieces chegam ao estado visto, e fora da rodada a oferta some", () => {
  const rows = [
    {
      ts: 1100,
      feature: "match_info",
      key: "round_type",
      round: "2-3",
      data: '{"stage":"2-3","name":"PVP","type":"PVP"}',
    },
    {
      ts: 1200,
      feature: "match_info",
      key: "round_type",
      round: "2-4",
      data: '{"stage":"2-4","name":"Carousel","type":"Carousel"}',
    },
    {
      ts: 1200,
      type: "carousel",
      feature: "carousel",
      key: "carousel_pieces",
      round: "2-4",
      data: PIECES_2_4,
    },
  ];
  const file = makeDb(rows);
  const clock = { t: 1210_000 };
  const gep = gepReader({
    file,
    now: () => clock.t,
    champions,
    items,
    minIntervalMs: 0,
  });
  const status = gep.status({ gameId: "4000000001", inMatch: true, set: 18 });
  assert.equal(status.state, "ativo");
  assert.equal(status.fields.carousel.stage, "2-4");
  assert.equal(status.fields.carousel.value.length, 6);
  assert.equal(status.fields.stage.name, "Carousel");

  const seen = mergeGep(
    mergeSources(
      { stage: null, gold: null },
      { available: true, stage: "2-4", phase: "Draft", phaseKind: "draft" },
    ),
    status,
  );
  assert.deepEqual(seen.gepRound, {
    stage: "2-4",
    name: "Carousel",
    ageMs: seen.gepRound.ageMs,
  });
  assert.equal(seen.carouselOffer.slots.length, 6);
  assert.equal(seen.carouselOffer.stage, "2-4");
  assert.equal(seen.sources.carousel, "gep");
  // Sem GEP ativo nada disso existe (nada inventado).
  const off = mergeGep(mergeSources({ stage: "2-4" }, null), {
    available: false,
    state: "ausente",
  });
  assert.equal(off.carouselOffer, undefined);
  assert.equal(off.gepRound, undefined);
});

test("GEP do banco real: banco sem a coluna round usa a rodada do último round_type", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carousel-test-"));
  const file = path.join(dir, "tft-events.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE games (id text PRIMARY KEY NOT NULL, started_at integer NOT NULL, ended_at integer, set_number real, created_at integer NOT NULL, match_id text);
    CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, game_id text NOT NULL, timestamp integer NOT NULL,
      event_type text NOT NULL, key text, data text, created_at integer NOT NULL, feature text);`);
  db.prepare(
    "INSERT INTO games (id, started_at, set_number, created_at, match_id) VALUES ('g1',1000,18,1000,'BR1_4000000001')",
  ).run();
  const ins = db.prepare(
    "INSERT INTO events (game_id, timestamp, event_type, key, data, created_at, feature) VALUES ('g1',?,?,?,?,?,?)",
  );
  ins.run(
    1200,
    "match_info",
    "round_type",
    '{"stage":"3-4","name":"Carousel"}',
    1200,
    "match_info",
  );
  ins.run(1200, "carousel", "carousel_pieces", PIECES_5_4, 1200, "carousel");
  db.close();
  const gep = gepReader({
    file,
    now: () => 1210_000,
    champions,
    items,
    minIntervalMs: 0,
  });
  const status = gep.status({ gameId: "4000000001", inMatch: true, set: 18 });
  assert.equal(status.state, "ativo");
  assert.equal(status.fields.carousel.stage, "3-4");
});

/* ---------- Bloco do /api/state ---------- */

const plan = BASE.rec.recommendations[0];
const recBody = {
  ...BASE.rec,
  metadata: { ...BASE.rec.metadata, gameId: "3291205051" },
};
const seenAt = (extra = {}) => ({
  stage: "2-4",
  phaseKind: "draft",
  items: [],
  ...extra,
});
const offerOf = (json, stage = "2-4") => ({
  stage,
  slots: parseCarouselPieces(
    json,
    (n) => champions.has(n),
    (n) => items.has(n),
  ).slots,
  unknown: 0,
  ageMs: 900,
});

test("fora do carrossel (ou sem saber) o bloco traz só a detecção: nada é calculado", () => {
  const out = carouselView(seenAt({ phaseKind: "planning" }), { rec: recBody });
  assert.deepEqual(
    [out.active, out.from, out.picks, out.offer],
    [false, null, [], null],
  );
  const unknown = carouselView({}, { rec: recBody });
  assert.deepEqual([unknown.active, unknown.picks], [null, []]);
  assert.deepEqual(carouselView(null).picks, []);
});

test("carrossel lido: as peças do GEP em ordem de valor para o plano, com o campeão e o item de cada uma", () => {
  const out = carouselView(
    seenAt({
      gepRound: { stage: "2-4", name: "Carousel" },
      carouselOffer: offerOf(PIECES_2_4),
    }),
    { rec: recBody, gameId: "3291205051" },
  );
  assert.equal(out.active, true);
  assert.equal(out.from, "reading");
  assert.equal(out.source, "game-log");
  assert.deepEqual(
    [out.offer.stage, out.offer.count, out.offer.unknown],
    ["2-4", 6, 0],
  );
  assert.equal(out.picks.length, 6, "a lista sai inteira");
  assert.deepEqual(
    out.picks.map((p) => p.rank),
    [1, 2, 3, 4, 5, 6],
  );
  // Ordem do maior para o menor valor.
  const scores = out.picks.map((p) => p.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
  // Aphelios (carry) com o B.F. Sword: o componente e o campeão do plano somam; vem antes das peças sem uso no plano.
  const first = out.picks[0];
  assert.equal(first.championId, "DA_18_Aphelios");
  assert.equal(first.itemId, "DA_Component_BFSword");
  assert.match(first.reason, /carry do plano/);
  // Toda peça lida traz campeão e item como ids (a interface resolve os retratos) e uma razão.
  for (const p of out.picks) {
    assert.ok(p.championId && p.itemId, `peça ${p.slot}`);
    assert.ok(p.reason.length > 0);
  }
  assert.equal(out.plan.carry, plan.carry);
  assert.equal(out.note, null);
});

test("carrossel sem leitura (GEP ausente): lista de PRIORIDADE do banco e do plano, dita como tal", () => {
  const out = carouselView(seenAt({ items: ["DA_Component_BFSword"] }), {
    rec: recBody,
    gameId: "3291205051",
  });
  assert.equal(out.active, true);
  assert.equal(out.from, "priority");
  assert.equal(out.offer, null);
  assert.ok(out.picks.length >= 1 && out.picks.length <= 5);
  assert.match(out.note, /não foi lido/);
  for (const p of out.picks) {
    assert.equal(p.slot, null, "sem peça lida: não há slot nem campeão");
    assert.equal(p.championId, null);
    assert.ok(p.itemId.startsWith("DA_Component_"));
    assert.equal(p.kind, "component");
  }
  assert.deepEqual(
    out.picks.map((p) => p.rank),
    out.picks.map((_, i) => i + 1),
  );
  // O banco de AGORA entra na conta (não o da análise): o B.F. Sword que já está no banco não é pedido de novo para a 1ª cópia.
  const empty = carouselView(seenAt({ items: [] }), {
    rec: recBody,
    gameId: "3291205051",
  });
  assert.notDeepEqual(
    out.picks.map((p) => [p.itemId, p.score]),
    empty.picks.map((p) => [p.itemId, p.score]),
  );
});

test("oferta de outra rodada, análise de outra partida ou sem análise: nada de leitura inventada", () => {
  // A oferta do carrossel anterior (3-4) não vale em 4-4: cai para a prioridade.
  const stale = carouselView(
    seenAt({ stage: "4-4", carouselOffer: offerOf(PIECES_2_4, "3-4") }),
    { rec: recBody, gameId: "3291205051" },
  );
  assert.equal(stale.from, "priority");
  assert.equal(stale.offer, null);
  // Análise de outra partida não serve de base.
  const other = carouselView(seenAt(), { rec: recBody, gameId: "999" });
  assert.deepEqual([other.from, other.picks], [null, []]);
  assert.match(other.note, /Sem análise/);
  // Sem análise nenhuma mas COM leitura: as peças saem na ordem do carrossel, sem nota.
  const raw = carouselView(seenAt({ carouselOffer: offerOf(PIECES_2_4) }), {
    rec: null,
  });
  assert.equal(raw.from, "reading");
  assert.equal(raw.picks.length, 6);
  assert.ok(raw.picks.every((p) => p.score === null && p.rank === null));
  assert.match(raw.note, /Sem análise/);
  // Análise sem builds (plano vazio).
  const empty = carouselView(seenAt(), {
    rec: { recommendations: [{ itemPlans: [] }] },
  });
  assert.deepEqual([empty.from, empty.picks], [null, []]);
});

test("carrossel de itens prontos e emblemas (5-4): item da build vale mais; emblema só se o plano usa a sinergia", () => {
  const emblems = new Map([["DA_18_EmblemLunar", "Lunar"]]);
  const out = carouselView(
    seenAt({ stage: "5-4", carouselOffer: offerOf(PIECES_5_4, "5-4") }),
    {
      rec: recBody,
      gameId: "3291205051",
      emblemTrait: (id) => emblems.get(id) ?? null,
    },
  );
  assert.equal(out.from, "reading");
  const by = Object.fromEntries(out.picks.map((p) => [p.itemId, p]));
  assert.equal(by.DA_18_EmblemLunar.kind, "emblem");
  assert.match(by.DA_18_EmblemLunar.reason, /Lunar/);
  // Lunar está entre as sinergias do plano: o emblema pontua; o item que nenhuma build pede, não.
  assert.ok(
    by.DA_18_EmblemLunar.score > by.DA_VoidStaff.score ||
      by.DA_VoidStaff.score > 0,
  );
  assert.equal(by.DA_VoidStaff.kind, "item");
  assert.equal(out.picks[0].rank, 1);
});

test("carouselFeed: lê a última análise do feed do overlay e o mapa de emblemas do servidor", () => {
  const overlay = createOverlayFeed();
  const feed = carouselFeed({ overlay, emblems: new Map() });
  // Feed vazio: sem análise.
  assert.deepEqual(feed(seenAt(), "3291205051").picks, []);
  overlay.recordRecommendation(recBody);
  const out = feed(seenAt(), "3291205051");
  assert.equal(out.from, "priority");
  assert.ok(out.picks.length > 0);
  assert.equal(overlay.recommendationBody(), recBody);
});

/* ---------- Composição do servidor: fontes -> estado visto -> bloco ---------- */

/** O que `buildStateBody` faz: o hub mescla tela + arquivos do jogo + GEP e o bloco do carrossel sai do estado visto. */
function serverBlock({
  gameFiles,
  file,
  screen = { stage: null, running: true },
  rec = recBody,
  clock,
}) {
  const hub = createStateHub({
    screen: { status: () => screen },
    gameFiles: { status: () => gameFiles },
    gep: gepReader({
      file,
      now: () => clock.t,
      champions,
      items,
      minIntervalMs: 0,
    }),
    now: () => clock.t,
  });
  const overlay = createOverlayFeed();
  if (rec) overlay.recordRecommendation(rec);
  const seen = hub.seen("4000000001", {
    gameId: "4000000001",
    inMatch: true,
    set: 18,
  });
  return { seen, block: carouselFeed({ overlay })(seen, "3291205051") };
}
const liveRows = [
  {
    ts: 1100,
    feature: "match_info",
    key: "round_type",
    round: "2-3",
    data: '{"stage":"2-3","name":"PVP","type":"PVP"}',
  },
  {
    ts: 1200,
    feature: "match_info",
    key: "round_type",
    round: "2-4",
    data: '{"stage":"2-4","name":"Carousel","type":"Carousel"}',
  },
  {
    ts: 1200,
    type: "carousel",
    feature: "carousel",
    key: "carousel_pieces",
    round: "2-4",
    data: PIECES_2_4,
  },
];

test("servidor: fase Draft do jogo + peças do GEP => carrossel lido, decidido pelo arquivo do jogo", () => {
  const { seen, block } = serverBlock({
    file: makeDb(liveRows),
    clock: { t: 1210_000 },
    gameFiles: {
      available: true,
      stage: "2-4",
      phase: "Draft",
      phaseKind: "draft",
    },
  });
  assert.equal(seen.phaseKind, "draft");
  assert.equal(block.active, true);
  assert.equal(block.source, "game-log");
  assert.equal(block.from, "reading");
  assert.equal(block.picks.length, 6);
  assert.equal(block.offer.count, 6);
});

test("servidor: sem os arquivos do jogo, o round_type 'Carousel' do GEP decide e as peças vêm do GEP", () => {
  const { block } = serverBlock({
    file: makeDb(liveRows),
    clock: { t: 1210_000 },
    gameFiles: { available: false },
  });
  assert.equal(block.active, true);
  assert.equal(block.source, "gep");
  assert.equal(block.confidence, "observed");
  assert.equal(block.from, "reading");
});

test("servidor: o carrossel acaba quando a rodada muda, mesmo com a oferta antiga ainda no GEP", () => {
  const rows = [
    ...liveRows,
    {
      ts: 1240,
      feature: "match_info",
      key: "round_type",
      round: "2-5",
      data: '{"stage":"2-5","name":"PVP","type":"PVP"}',
    },
  ];
  const after = serverBlock({
    file: makeDb(rows),
    clock: { t: 1250_000 },
    gameFiles: {
      available: true,
      stage: "2-5",
      phase: "Planning",
      phaseKind: "planning",
    },
  });
  assert.equal(after.block.active, false);
  assert.deepEqual(after.block.picks, []);
  assert.equal(
    after.seen.carouselOffer.stage,
    "2-4",
    "o GEP guarda a oferta; quem decide é a rodada atual",
  );
});

test("servidor: sem GEP nem arquivos do jogo, só o calendário (estimado) e a lista de prioridade", () => {
  const { block } = serverBlock({
    file: path.join(os.tmpdir(), "nao-existe", "tft-events.db"),
    clock: { t: 1210_000 },
    screen: { stage: "3-4", running: true, items: ["DA_Component_BFSword"] },
    gameFiles: { available: false },
  });
  assert.equal(block.active, true);
  assert.equal(block.source, "schedule");
  assert.equal(block.confidence, "estimated");
  assert.equal(block.from, "priority");
  assert.match(block.note, /não foi lido/);
});

test("reducer: coluna round '0-0' (ponte própria antes da 1ª rodada) não é rodada; vale a do round_type", () => {
  const env = {
    isChampion: (n) => champions.has(n),
    isItem: (n) => items.has(n),
  };
  const state = emptyGepState();
  applyGepEvent(
    state,
    {
      id: 1,
      ts: 10,
      feature: "match_info",
      key: "round_type",
      round: "2-4",
      data: '{"stage":"2-4","name":"Carousel"}',
    },
    env,
  );
  applyGepEvent(
    state,
    {
      id: 2,
      ts: 10,
      feature: "carousel",
      key: "carousel_pieces",
      round: "0-0",
      data: PIECES_2_4,
    },
    env,
  );
  assert.equal(state.carousel.stage, "2-4");
});
