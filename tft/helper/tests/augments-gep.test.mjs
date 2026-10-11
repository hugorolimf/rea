// Aprimoramentos detectados sem OCR, ponta a ponta com dados REAIS do GEP (tests/fixtures/gep-augments.json: eventos de
// aprimoramento de 3 partidas do tft-events.db do TFTAcademy, sem nomes de jogadores): banco no esquema do TFTAcademy ->
// leitor GEP -> estado do servidor (app/state.mjs) -> escolhidos na análise (chosenAugmentIds, como app/recommend.mjs) ->
// motor/plano/conselho de escolha (pipeline do golden) -> tela (Ao vivo: augOfferView; overlay: overlayView + draw).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStateHub } from "../app/state.mjs";
import { chosenAugmentIds, gepReader } from "../gep-reader.mjs";
import { traitBook } from "../core/catalog/traits.mjs";
import { augOfferView, augPath } from "../v2/js/augs.js";
import {
  loadContext,
  loadSnapshots,
  newRun,
  runStep,
} from "./golden/harness.mjs";

const read = (rel) =>
  JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const FIXTURE = read("./fixtures/gep-augments.json");
const GAME = Object.fromEntries(FIXTURE.games.map((g) => [g.label, g.rows]));
const catalog = read("../catalog.json");
const AUGMENTS = read("../augments.json").augments;
const AUG_IDS = new Set(AUGMENTS.map((a) => a.id));
const byId = new Map(AUGMENTS.map((a) => [a.id, a]));

const START = 1_800_000_000; // games.started_at (segundos); o dt do fixture soma a isto
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "augments-gep-"));
let files = 0;

/** Banco vazio no esquema do TFTAcademy; `addGame` registra uma partida (com match_id) e devolve o id dela. */
function newDb() {
  const file = path.join(tmp, `tft-events-${++files}.db`);
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE games (id text PRIMARY KEY NOT NULL, started_at integer NOT NULL, ended_at integer, game_version text,
      set_number real, player_puuid text, final_placement integer, queue_type integer, created_at integer NOT NULL, match_id text);
    CREATE TABLE events (id integer PRIMARY KEY AUTOINCREMENT NOT NULL, game_id text NOT NULL, timestamp integer NOT NULL,
      event_type text NOT NULL, player_id text, round text, stage_type text, key text, data text, created_at integer NOT NULL,
      feature text, category text);`);
  db.close();
  return file;
}
function addGame(file, id, matchId, start) {
  const db = new DatabaseSync(file);
  db.prepare(
    "INSERT INTO games (id, started_at, set_number, queue_type, created_at, match_id) VALUES (?,?,?,?,?,?)",
  ).run(id, start, 18, 1100, start, matchId);
  db.close();
}
/** Grava as linhas do fixture com `dt` em (`from`, `to`] como o TFTAcademy as gravaria. */
function feed(file, gameId, start, rows, from, to) {
  const db = new DatabaseSync(file);
  const ins = db.prepare(
    "INSERT INTO events (game_id, timestamp, event_type, round, key, data, created_at, feature, category) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (const r of rows)
    if (r.dt > from && r.dt <= to)
      ins.run(
        gameId,
        start + r.dt,
        r.event_type,
        r.round,
        r.key,
        r.data,
        start + r.dt,
        r.feature,
        r.feature,
      );
  db.close();
}

/**
 * O servidor em miniatura: o leitor GEP sobre `file` e o montador de estado com uma tela que AINDA "lê" uma oferta por OCR
 * (`DA_Kingslayer`, de propósito): ela nunca pode aparecer. `seen(gameId)` = o `state.screen` do /api/state.
 */
function server(file, { augments = AUG_IDS } = {}) {
  const clock = { t: 0 };
  const hub = createStateHub({
    screen: {
      status: () => ({
        running: true,
        stage: null,
        augments: ["DA_Kingslayer"],
      }),
    },
    gameFiles: { status: () => ({ available: false }) },
    gep: gepReader({ file, now: () => clock.t, augments, minIntervalMs: 0 }),
    now: () => clock.t,
  });
  return {
    clock,
    seen: (gameId) => {
      const { gepStatus, ...seen } = hub.seen(gameId, {
        gameId,
        inMatch: true,
        set: 18,
      });
      return { ...seen, gepStatus };
    },
  };
}

/** Uma partida real do fixture tocada até `dt`: grava as linhas até lá e lê o estado 1 s depois. */
function liveGame(label, { augments } = {}) {
  const file = newDb(),
    srv = server(file, { augments }),
    rows = GAME[label];
  addGame(file, label, "BR1_4000000001", START);
  let at = -1;
  return {
    file,
    srv,
    to(dt) {
      feed(file, label, START, rows, at, dt);
      at = dt;
      srv.clock.t = (START + dt + 1) * 1000;
      return srv.seen("4000000001");
    },
  };
}
const ids = (seen) => seen.augmentOffer?.cards.map((c) => c.id);

test("oferta real do GEP (45e4f45b, 2-1): as 3 cartas no estado, mapeadas ao catálogo, e a oferta lida por OCR descartada", () => {
  const g = liveGame("45e4f45b");
  const s = g.to(93);
  assert.equal(s.gepStatus.state, "ativo");
  assert.deepEqual(s.augments, [
    "DA_BacklineBlueprint",
    "DA_HeroicGrabBag",
    "DA_Replication",
  ]);
  assert.equal(s.sources.augments, "gep");
  assert.equal(s.augmentOffer.open, true);
  assert.equal(s.augmentOffer.stage, "2-1");
  assert.deepEqual(
    s.augmentOffer.cards.map((c) => c.rerolled),
    [false, false, false],
  );
  assert.equal(s.augmentSource.state, "ativo");
  assert.ok(!s.augments.includes("DA_Kingslayer"), "nada de OCR");
});

test("reroll real: cada linha troca UMA carta; a trocada fica marcada até a rodada seguinte (cada carta troca uma vez)", () => {
  const g = liveGame("45e4f45b");
  g.to(93);
  // Em dt=101 vieram duas linhas: o espaço 2 (HeroicGrabBag -> ClearMind) e depois o 3 (Replication -> WorththeWait).
  const s = g.to(101);
  assert.deepEqual(ids(s), [
    "DA_BacklineBlueprint",
    "DA_ClearMind",
    "DA_WorththeWait",
  ]);
  assert.deepEqual(
    s.augmentOffer.cards.map((c) => c.rerolled),
    [false, true, true],
  );
  // 3-2 (outra rodada): começa sem trocas; a troca do espaço 1 e depois a do 3 são vistas em ordem.
  assert.deepEqual(
    g.to(592).augmentOffer.cards.map((c) => c.rerolled),
    [false, false, false],
  );
  assert.deepEqual(
    g.to(597).augmentOffer.cards.map((c) => c.rerolled),
    [true, false, true],
  );
});

test("escolha real: a oferta fecha e o escolhido entra com o estágio; as 3 rodadas acumulam em ordem (2-1, 3-2, 4-2)", () => {
  const g = liveGame("45e4f45b");
  g.to(101);
  const picked = g.to(110);
  assert.deepEqual(picked.augments, [], "escolha fechada");
  assert.equal(picked.augmentOffer.open, false);
  assert.deepEqual(picked.pickedAugments, [
    { id: "DA_BacklineBlueprint", stage: "2-1" },
  ]);
  assert.equal(picked.sources.pickedAugments, "gep");
  assert.equal(picked.augmentSource.picked, 1);
  const end = g.to(1034);
  assert.deepEqual(end.pickedAugments, [
    { id: "DA_BacklineBlueprint", stage: "2-1" },
    { id: "DA_PandorasItemsI", stage: "3-2" },
    { id: "DA_HeroicGrabBagPlusPlus", stage: "4-2" },
  ]);
  // A análise usa os do GEP quando o usuário não corrigiu nada (o mesmo que app/recommend.mjs faz).
  const pick = chosenAugmentIds({
    gepPicked: end.pickedAugments,
    valid: (id) => byId.has(id),
  });
  assert.equal(pick.source, "gep");
  assert.deepEqual(pick.ids, [
    "DA_BacklineBlueprint",
    "DA_PandorasItemsI",
    "DA_HeroicGrabBagPlusPlus",
  ]);
  // Na tela (trilha do Ao vivo), cada um na sua rodada.
  const trail = augPath(
    end.pickedAugments,
    new Map(pick.ids.map((id) => [id, byId.get(id)])),
  );
  assert.deepEqual(
    trail.map((s) => [s.stage, s.aug?.name]),
    [
      ["2-1", byId.get("DA_BacklineBlueprint").name],
      ["3-2", byId.get("DA_PandorasItemsI").name],
      ["4-2", byId.get("DA_HeroicGrabBagPlusPlus").name],
    ],
  );
});

test("GEP em silêncio: 'sem fonte' para a oferta, mas os escolhidos da MESMA partida ficam (retidos); outra partida não os herda", () => {
  const g = liveGame("45e4f45b");
  g.to(1034);
  g.srv.clock.t = (START + 1034 + 120) * 1000; // 2 min sem eventos: o GEP fica obsoleto
  const quiet = g.srv.seen("4000000001");
  assert.equal(quiet.gepStatus.state, "obsoleto");
  assert.equal(quiet.augments, null, "sem oferta inventada (nem a do OCR)");
  assert.equal(quiet.augmentSource.state, "sem-fonte");
  assert.equal(quiet.augmentSource.reason, "sem-eventos-recentes");
  assert.equal(quiet.augmentSource.held, true);
  assert.equal(quiet.pickedAugments.length, 3);
  assert.equal(quiet.sourcesDetail.pickedAugments.held, true);
  const other = g.srv.seen("4000000999");
  assert.equal(other.pickedAugments, undefined);
  assert.equal(other.augmentSource.state, "sem-fonte");
});

test("partida nova no banco: os escolhidos da anterior somem e os da nova começam do zero", () => {
  const g = liveGame("45e4f45b");
  assert.equal(g.to(1034).pickedAugments.length, 3);
  const start2 = START + 3000;
  addGame(g.file, "84efb955", "BR1_4000000002", start2);
  feed(g.file, "84efb955", start2, GAME["84efb955"], -1, 130);
  g.srv.clock.t = (start2 + 131) * 1000;
  const next = g.srv.seen("4000000002");
  assert.equal(next.gepStatus.state, "ativo");
  assert.deepEqual(next.pickedAugments, [
    { id: "DA_SpeedyDoubleKill", stage: "2-1" },
  ]);
});

test("nome fora do catálogo: a carta fica de fora da análise, mas NOMEADA no estado e na tela (nunca descartada em silêncio)", () => {
  const without = new Set([...AUG_IDS].filter((id) => id !== "DA_ClearMind"));
  const g = liveGame("45e4f45b", { augments: without });
  const s = g.to(101);
  assert.deepEqual(s.augments, ["DA_BacklineBlueprint", "DA_WorththeWait"]);
  assert.deepEqual(s.augmentOffer.cards[1], {
    slot: 2,
    id: null,
    text: "DA_ClearMind",
    rerolled: true,
  });
  assert.deepEqual(s.augmentOffer.unresolved, ["DA_ClearMind"]);
  assert.deepEqual(s.gepStatus.coverage.augmentUnresolved, ["DA_ClearMind"]);
  const view = augOfferView(s, null);
  assert.equal(view.cards.at(-1).unknown, true);
  assert.equal(view.cards.at(-1).name, "Clear Mind");
  assert.deepEqual(view.unresolved, ["DA_ClearMind"]);
});

test("sem o banco do TFTAcademy: 'aprimoramentos: sem fonte' com o motivo, sem oferta (nem a do OCR) e sem escolhidos", () => {
  const srv = server(path.join(tmp, "nao-existe", "tft-events.db"));
  const s = srv.seen("4000000001");
  assert.equal(s.augments, null);
  assert.equal(s.pickedAugments, undefined);
  assert.equal(s.augmentSource.state, "sem-fonte");
  assert.equal(s.augmentSource.reason, "banco-ausente");
  const view = augOfferView({ ...s, stage: "2-1" }, null);
  assert.equal(view.source.text, "aprimoramentos: sem fonte");
  assert.match(view.source.title, /TFTAcademy/);
  assert.equal(view.open, false);
});

/* ---------- Motor, plano e conselho de escolha (pipeline do golden, sem servidor) ---------- */

const ctx = await loadContext();
const snapshots = loadSnapshots();

test("motor: o escolhido do GEP (2-1 real, aprimoramento de traço) vira sinergia concedida, entra na análise, no plano e ordena a oferta 3-2 real", () => {
  const g = liveGame("b7f42f17");
  const at32 = g.to(
    GAME.b7f42f17.find((r) => r.round === "3-2" && r.key === "me").dt,
  );
  assert.deepEqual(at32.pickedAugments, [
    { id: "DA_BlackthornTraitAugment", stage: "2-1" },
  ]);
  const pick = chosenAugmentIds({
    gepPicked: at32.pickedAugments,
    valid: (id) => byId.has(id),
  });
  const chosen = pick.ids.map((id) => byId.get(id));
  // Regra única de traços (core/catalog/traits.mjs): o aprimoramento de traço concede a sinergia ao motor.
  const book = traitBook(catalog),
    grants = book.grants(chosen);
  const blackthorn = book.nameOf("DA_18_Blackthorn");
  assert.ok(blackthorn);
  assert.ok(grants.traits.includes(blackthorn), grants.traits.join(","));
  // A análise completa recebe os escolhidos do GEP como `options.augments` (app/recommend.mjs) e a oferta do estado.
  const out = runStep(ctx, newRun(ctx), {
    snapshot: snapshots.get("items-8u"),
    client: { level: 6, gold: 30, augments: pick.ids },
    seen: { stage: "3-2", augments: at32.augments },
  }).response;
  assert.deepEqual(
    out.chosenAugments.map((a) => a.id),
    ["DA_BlackthornTraitAugment"],
  );
  assert.ok(out.chosenAugments[0].traits.includes(blackthorn));
  assert.equal(
    out.planProgress.augments[0].id,
    "DA_BlackthornTraitAugment",
    "Plano: 2-1 feito",
  );
  // Conselho para a oferta aberta de agora: as 3 cartas reais, e a tela casa a análise com a oferta pela chave.
  assert.equal(out.augmentAdvice.choices.length, 3);
  assert.equal(out.augmentAdvice.key, [...at32.augments].sort().join("|"));
  const view = augOfferView(at32, out.augmentAdvice);
  assert.equal(view.pending, false);
  assert.equal(view.open, true);
  assert.equal(view.cards.length, 3);
  assert.deepEqual(
    view.cards.map((c) => c.rank),
    [1, 2, 3],
  );
  assert.equal(view.cards.filter((c) => c.best).length <= 1, true);
  // Reroll da 3-2: a análise antiga não vale para a oferta nova ("analisando" até a próxima).
  const rerolled = g.to(
    GAME.b7f42f17.filter((r) => r.round === "3-2" && r.key === "me")[1].dt,
  );
  const stale = augOfferView(rerolled, out.augmentAdvice);
  assert.equal(stale.pending, true);
  assert.ok(stale.cards.some((c) => c.rerolled));
});

/* ---------- Overlay ---------- */

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const { overlayView } = await import("../overlay/hud/view.mjs");
const { createDraw } = await import("../overlay/hud/draw.mjs");
const { buildModel } = await import("../v2/js/model.js");
const { planView } = await import("../v2/js/plan.js");
const { PART_STATE, nextItemRecipe } = await import("../v2/js/next-item.js");
const { buildStates } = await import("../v2/js/item-source.js");
const { realCatalog } = await import("../v2/js/catalog-fixture.mjs");
const glyphs = await import("../v2/js/ui/glyphs.js");
const rich = await import("../v2/js/ui/rich-text.js");
const { esc } = await import("../v2/js/dom.js");
const uiCatalog = realCatalog();
glyphs.setCatalog(uiCatalog);
const draw = createDraw({
  esc,
  glyph: glyphs.glyph,
  portrait: glyphs.portrait,
  unitPortrait: glyphs.unitPortrait,
  itemPortrait: glyphs.itemPortrait,
  nameChip: rich.nameChip,
  richText: rich.richText,
  stars: glyphs.stars,
});
const deps = {
  buildModel,
  planView,
  nextItemRecipe,
  partState: PART_STATE,
  buildStates,
  catalogItems: uiCatalog.items,
  catalog: uiCatalog,
  augOfferView,
};
const BASE = read("../live-mock-base.json");

/** Estado ao vivo (formato real) com o `screen` do servidor de agora e a análise com o conselho da oferta. */
function overlayFeed(screen, advice) {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.screen = { running: true, gold: 30, level: 6, ...screen };
  Object.assign(state, {
    actionable: true,
    sameGame: true,
    phase: "InProgress",
    ageSeconds: 3,
    gameId: "3291205051",
  });
  rec.metadata.actionable = true;
  rec.metadata.gameId = "3291205051";
  rec.self.health = 80;
  rec.augmentAdvice = advice;
  return overlayView(
    {
      unchanged: false,
      rev: "1",
      state: { at: 0, ageMs: 400, body: state },
      recommendation: { at: 0, ageMs: 800, body: rec },
    },
    { catalogReady: true, now: 10_000, receivedAt: 10_000, deps },
  );
}

test("overlay: com a escolha aberta no jogo, o cartão de aprimoramentos é o primeiro, com a ordem da análise; fechada, some", () => {
  const g = liveGame("b7f42f17");
  const at32 = g.to(
    GAME.b7f42f17.find((r) => r.round === "3-2" && r.key === "me").dt,
  );
  const cards = at32.augmentOffer.cards.map((c) => c.id);
  const advice = {
    choices: [cards[2], cards[0], cards[1]].map((id, i) => ({
      id,
      name: byId.get(id).name,
      desc: byId.get(id).desc,
      reasons: [`motivo ${i + 1}`],
      expected: 4 + i / 10,
      reroll: i === 2,
    })),
    pick: cards[2],
    key: [...cards].sort().join("|"),
    comp: "Comp de teste",
    note: "nota",
  };
  const v = overlayFeed(at32, advice);
  assert.equal(v.sections[0], "augments");
  assert.equal(v.augments.open, true);
  assert.deepEqual(
    v.augments.cards.map((c) => c.id),
    [cards[2], cards[0], cards[1]],
  );
  assert.equal(v.augments.cards[0].best, true);
  const html = draw.augments(v);
  assert.match(html, /Aprimoramento 3-2/);
  assert.match(html, new RegExp(esc(byId.get(cards[2]).name)));
  assert.match(html, /lido do jogo/);
  assert.match(html, /troque/, "a 3ª opção ainda pode ser trocada");
  // Escolha feita (oferta vazia do GEP + picked_augment): o cartão some.
  const after = g.to(
    GAME.b7f42f17.find((r) => r.round === "3-2" && r.key === "picked_augment")
      .dt,
  );
  const closed = overlayFeed(after, advice);
  assert.equal(closed.augments, null);
  assert.equal(draw.augments(closed), "");
  assert.ok(!closed.sections.includes("augments"));
});

test("overlay: sem GEP, na rodada de aprimoramento o cartão diz 'sem fonte'; fora dela não ocupa espaço", () => {
  const srv = server(path.join(tmp, "nao-existe-2", "tft-events.db"));
  const s = srv.seen("4000000001");
  const v = overlayFeed({ ...s, stage: "2-1" }, null);
  assert.equal(v.augments.source.state, "sem-fonte");
  assert.match(draw.augments(v), /sem fonte/);
  assert.equal(overlayFeed({ ...s, stage: "2-3" }, null).augments, null);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
