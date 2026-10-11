// Rodar com: node --test tft/helper/tests/overlay-hud.test.mjs
// HUD do overlay (overlay/hud): o modelo de tela (view.mjs) sobre dados no formato real de /api/state e /api/recommend
// (live-mock-base.json), a consulta de /api/overlay (poll.mjs), o HTML das seções (draw.mjs) e as fronteiras da página:
// todo import resolve para um arquivo servido e nada pede análise nem estado ao servidor.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importsOf, read, root, stripNonCode } from "./architecture/scan.mjs";
import { staticTarget } from "../static-files.mjs";
import { buildModel } from "../v2/js/model.js";
import { planView } from "../v2/js/plan.js";
import { PART_STATE, nextItemRecipe } from "../v2/js/next-item.js";
import { buildStates } from "../v2/js/item-source.js";
import { realCatalog } from "../v2/js/catalog-fixture.mjs";
import { STALE_AFTER_MS, ageText, overlayView } from "../overlay/hud/view.mjs";
import {
  MAX_BACKOFF_MS,
  POLL_MS,
  parseFeed,
  retryDelay,
  startPolling,
} from "../overlay/hud/poll.mjs";

// A interface lê matchMedia e CSS no import; o Node não os tem.
globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
globalThis.CSS ??= { supports: () => false };
const glyphs = await import("../v2/js/ui/glyphs.js");
const rich = await import("../v2/js/ui/rich-text.js");
const { esc } = await import("../v2/js/dom.js");
const { createDraw } = await import("../overlay/hud/draw.mjs");

const catalog = realCatalog();
glyphs.setCatalog(catalog);
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
  catalogItems: catalog.items,
};

const BASE = JSON.parse(
  fs.readFileSync(new URL("../live-mock-base.json", import.meta.url), "utf8"),
);
const SUN = "DA_SunfireCape";

/** Estado e análise ao vivo no formato real (mesma base do model.test), com o que o overlay apresenta. */
function liveInput() {
  const state = structuredClone(BASE.state),
    rec = structuredClone(BASE.rec);
  state.screen = {
    running: true,
    stage: "4-2",
    gold: 54,
    level: 8,
    xp: "23/68",
    items: ["DA_Component_ChainVest"],
  };
  Object.assign(state, {
    actionable: true,
    sameGame: true,
    phase: "InProgress",
    ageSeconds: 3,
  });
  rec.metadata.actionable = true;
  rec.self.health = 58;
  const plan = rec.recommendations[0],
    stage = plan.stage.board;
  // Diana monta a Sunfire (falta o cinturão); Sentinel recebe uma Bramble agora.
  stage.find((u) => u.id === "DA_18_Diana").nextItem = {
    id: SUN,
    name: "Sunfire Cape",
    missing: ["Giant's Belt"],
  };
  stage.find((u) => u.id === "DA_Sentinel18").equipNow = [
    { id: "DA_BrambleVest", name: "Bramble Vest" },
  ];
  // Veredito de rolagem como o servidor entrega (strategy.panels.rolling.call).
  Object.assign(plan.strategy.panels.rolling, {
    go: true,
    spend: 30,
    shops: 6,
    keep: 24,
    call: {
      kind: "go",
      title: "Vale rolar",
      go: true,
      reason: "Chance boa de evoluir Aphelios.",
      budget: 30,
    },
  });
  // Plano em andamento (planProgress de /api/recommend).
  rec.planProgress = {
    plan: {
      id: "m1",
      title: "Rapidfire · Aphelios",
      since: { stage: "2-3", level: 4 },
      pinned: false,
    },
    challenger: null,
    summary: { done: 3, total: 8, pct: 38 },
    next: [
      {
        kind: "unit",
        id: "DA_18_Aphelios",
        text: "Aphelios: 1→2★ (2/3 cópias)",
      },
    ],
    units: [
      {
        id: "DA_18_Aphelios",
        name: "Aphelios",
        cost: 4,
        carry: true,
        stars: 1,
        targetStars: 2,
        copies: 2,
        need: 3,
        status: "partial",
        where: "campo",
        lost: false,
        boughtUpTo: null,
      },
      {
        id: "DA_18_Varus",
        name: "Varus",
        cost: 4,
        carry: false,
        stars: 2,
        targetStars: 2,
        copies: 3,
        need: 3,
        status: "done",
        where: "campo",
        lost: false,
        boughtUpTo: null,
      },
    ],
    items: [
      {
        key: "i1",
        unitId: "DA_18_Aphelios",
        unit: "Aphelios",
        itemId: "DA_InfinityEdge",
        name: "Infinity Edge",
        status: "move",
        missing: [],
        from: "Nidalee",
      },
    ],
    augments: [],
    level: { status: "done", now: 8, target: 8 },
    gold: { status: "done", now: 54, interestAt: 60, floor: null },
    changes: [],
  };
  return { state, rec };
}

/** Resposta de /api/overlay com as idades (ms) de cada item do cache. */
const feedOf = ({ state = null, rec = null }, ages = {}) => ({
  unchanged: false,
  rev: "1",
  state: state && { at: 0, ageMs: ages.state ?? 500, body: state },
  recommendation: rec && { at: 0, ageMs: ages.rec ?? 800, body: rec },
});
const viewOf = (feed, extra = {}) =>
  overlayView(feed, {
    catalogReady: true,
    now: 10_000,
    receivedAt: 10_000,
    deps,
    ...extra,
  });

test("ao vivo: faixa, veredito, próximo item, equipar, passar itens, itens da formação e plano", () => {
  const v = viewOf(feedOf(liveInput()));
  assert.equal(v.status, "ready");
  assert.deepEqual(v.sections, ["roll", "items", "builds", "plan"]);
  assert.deepEqual(v.notices, []);
  assert.equal(v.dim, false);

  assert.equal(v.bar.stage, "4-2");
  assert.equal(v.bar.level.text, "8");
  assert.equal(v.bar.level.uncertain, false);
  assert.deepEqual(v.bar.xp, { text: "23/68", cost: null });
  assert.equal(v.bar.gold.value, 54);
  assert.equal(
    v.bar.gold.interest,
    3,
    "juros: o que a economia do servidor entregou",
  );
  assert.equal(v.bar.hp, 58);
  assert.deepEqual(v.bar.live, { kind: "live", text: "ao vivo" });

  // Veredito: o texto do servidor, sem recomputar nada.
  assert.equal(v.roll.pill, "rolar");
  assert.equal(v.roll.tone, "go");
  assert.equal(v.roll.title, "Vale rolar");
  assert.equal(v.roll.reason, "Chance boa de evoluir Aphelios.");
  assert.deepEqual(v.roll.spend, { gold: 30, shops: 6, keep: 24 });
  assert.equal(v.roll.budget, 30);

  // Próximo item: a Sunfire de Diana tem o colete no banco e falta o cinturão.
  const diana = v.items.next.find((r) => r.key === "next:DA_18_Diana");
  assert.equal(diana.unit.id, "DA_18_Diana");
  assert.equal(diana.unit.stars, 2);
  assert.equal(diana.item.id, SUN);
  assert.deepEqual(
    diana.parts.map((p) => [p.name, p.state, p.stateText]),
    [
      ["Chain Vest", "bank", PART_STATE.bank],
      ["Giant's Belt", "missing", PART_STATE.missing],
    ],
  );
  assert.equal(diana.complete, false);
  assert.equal(diana.incomplete, true);
  assert.equal(diana.note, "falta 1");

  assert.deepEqual(v.items.equip, [
    {
      key: "equip:DA_Sentinel18",
      kind: "equip",
      unit: { id: "DA_Sentinel18", name: "Sentinel", stars: 1 },
      items: [{ id: "DA_BrambleVest", name: "Bramble Vest" }],
      inField: true,
    },
  ]);
  assert.deepEqual(v.items.moves[0].moves, [
    {
      item: { id: "DA_InfinityEdge", name: "Infinity Edge" },
      to: { id: "DA_18_Varus", name: "Varus" },
    },
  ]);
  assert.equal(v.items.moves[0].now, false);

  // Itens da formação: o carry primeiro; o que a build pede nunca repete o que já está equipado.
  assert.equal(v.builds[0].carry, true);
  const amumu = v.builds.find((b) => b.id === "DA_Amumu18");
  assert.equal(amumu.equipped.length, 3);
  assert.ok(amumu.wanted.length > 0);
  for (const b of v.builds)
    for (const w of b.wanted) {
      assert.notEqual(w.kind, "on");
      assert.ok(!b.equipped.some((e) => e.id === w.id), `${b.name}: ${w.id}`);
    }

  // Plano: título, peças em campo e o checklist do servidor.
  assert.equal(v.plan.title, "Rapidfire · Aphelios");
  assert.deepEqual(v.plan.onBoard, { have: 4, total: 9 });
  assert.deepEqual(v.plan.progress, {
    pct: 38,
    done: 3,
    total: 8,
    since: "desde 2-3 · nível 4",
  });
  assert.deepEqual(
    v.plan.units.map((u) => [u.id, u.status]),
    [
      ["DA_18_Aphelios", "partial"],
      ["DA_18_Varus", "done"],
    ],
  );
  assert.equal(v.plan.units[0].line, "1→2★ · 2/3 cópias");
  assert.equal(v.plan.items[0].status, "move");
  assert.equal(v.plan.next[0].text, "Aphelios: 1→2★ (2/3 cópias)");
});

test("sem análise: só o que o estado tem e o texto 'aguardando análise' com a explicação", () => {
  const { state } = liveInput(),
    v = viewOf(feedOf({ state }));
  assert.equal(v.status, "idle");
  assert.equal(v.message.text, "aguardando análise");
  assert.match(v.message.title, /interface web/);
  assert.deepEqual(v.sections, []);
  assert.equal(v.roll, null);
  assert.equal(v.bar.stage, "4-2");
  assert.equal(v.bar.gold.value, 54);
  assert.equal(v.bar.level.text, "8");
  assert.equal(v.bar.hp, null, "a vida vem da análise: sem ela, a célula some");
  assert.equal(v.bar.live.text, "snapshot");
});

test("nada no cache, catálogo ausente e servidor sem resposta", () => {
  assert.equal(viewOf(null).status, "loading");
  assert.equal(viewOf(null).message.text, "conectando ao helper");
  const empty = viewOf(feedOf({}));
  assert.equal(empty.status, "no-state");
  assert.equal(empty.bar, null);
  const early = viewOf(feedOf(liveInput()), { catalogReady: false });
  assert.equal(early.status, "loading");
  assert.equal(early.message.text, "carregando dados do jogo");
  assert.equal(early.bar, null);
  assert.deepEqual(early.sections, []);
  const off = viewOf(feedOf(liveInput()), { offline: true });
  assert.equal(off.status, "ready", "o último desenho continua");
  assert.deepEqual(
    off.notices.map((n) => [n.kind, n.text]),
    [["offline", "sem resposta do servidor"]],
  );
});

test("análise velha: a idade do servidor soma o tempo local desde o recebimento", () => {
  const input = liveInput();
  const fresh = viewOf(feedOf(input, { rec: 100_000 }), {
    now: 10_000,
    receivedAt: 10_000,
  });
  assert.deepEqual(fresh.notices, []);
  assert.equal(fresh.dim, false);
  const old = viewOf(feedOf(input, { rec: 100_000 }), {
    now: 40_000,
    receivedAt: 10_000,
  });
  assert.equal(old.status, "ready");
  assert.equal(old.dim, true);
  assert.deepEqual(
    old.notices.map((n) => [n.kind, n.text]),
    [["analysis-old", "análise de há 130 s"]],
  );
  assert.ok(100_000 + 30_000 > STALE_AFTER_MS);
  assert.equal(ageText(130_000), "130 s");
  assert.equal(ageText(600_000), "10 min");
});

test("leitura do estado velha: nada vale como ao vivo (sem veredito de rolagem)", () => {
  const v = viewOf(feedOf(liveInput(), { state: STALE_AFTER_MS + 5_000 }));
  assert.equal(v.bar.live.kind, "snapshot");
  assert.equal(v.bar.stale, true);
  assert.equal(v.roll, null);
  assert.equal(v.dim, true);
  assert.equal(v.notices[0].kind, "state-old");
  assert.match(v.notices[0].text, /^leitura de há \d+ s$/);
});

test("nível: '≥' derivado do XP, '~' estimado pelo tabuleiro e o chip do GEP", () => {
  const derived = liveInput();
  derived.state.screen.sources = { level: "derived" };
  derived.state.gepStatus = { state: "ativo", lastEventAgeMs: 3000 };
  const d = viewOf(feedOf(derived));
  assert.equal(d.bar.level.text, "≥8");
  assert.equal(d.bar.level.uncertain, true);
  assert.deepEqual(d.bar.gep, {
    state: "ativo",
    short: "GEP ativo · 3s",
    label: "GEP ativo · último evento há 3s",
  });
  const guessed = liveInput();
  guessed.state.screen.level = null;
  guessed.state.estimatedLevel = 7;
  assert.equal(viewOf(feedOf(guessed)).bar.level.text, "~7");
});

test("nova partida sem tabuleiro próprio: espera, sem a análise da anterior", () => {
  const input = liveInput();
  input.state.match = {
    id: 99,
    status: "live",
    boardReady: false,
    last: { placement: 5 },
  };
  const v = viewOf(feedOf(input));
  assert.equal(v.status, "waiting");
  assert.equal(v.message.text, "Nova partida");
  assert.match(v.message.detail, /Partida anterior: 5º lugar\./);
  assert.deepEqual(v.sections, []);
  assert.equal(v.bar.live.text, "nova partida");
});

test("partida encerrada: colocação e nenhuma ação", () => {
  const input = liveInput();
  input.state.match = {
    id: input.rec.metadata.gameId,
    status: "ended",
    placement: 3,
    boardReady: true,
  };
  const v = viewOf(feedOf(input));
  assert.equal(v.status, "ended");
  assert.equal(v.message.text, "Partida encerrada · 3º lugar");
  assert.deepEqual(v.sections, []);
  assert.equal(v.bar.live.text, "encerrada · 3º");
  input.state.match.placement = null;
  const awaiting = viewOf(feedOf(input));
  assert.equal(awaiting.message.text, "Partida encerrada");
  assert.match(awaiting.message.detail, /tabuleiro final/);
});

test("análise de outra partida e snapshot de outro jogo não valem como decisão", () => {
  const other = liveInput();
  other.state.match = { id: 1, status: "live", boardReady: true };
  const v = viewOf(feedOf(other));
  assert.equal(v.status, "idle");
  assert.equal(v.message.text, "aguardando análise");
  const foreign = liveInput();
  foreign.state.sameGame = false;
  foreign.state.actionable = false; // o servidor só marca ao vivo no mesmo jogo
  const w = viewOf(feedOf(foreign));
  assert.ok(w.notices.some((n) => n.kind === "other-game"));
  assert.equal(w.bar.live.kind, "snapshot");
});

test("poll: recuo de 1 s até 5 s e retorno ao ritmo normal", () => {
  assert.equal(retryDelay(0), POLL_MS);
  assert.deepEqual([1, 2, 3, 4, 10].map(retryDelay), [
    2000,
    4000,
    MAX_BACKOFF_MS,
    MAX_BACKOFF_MS,
    MAX_BACKOFF_MS,
  ]);
});

test("poll: parseFeed rejeita versão desconhecida e cache em formato inesperado", () => {
  assert.deepEqual(parseFeed({ version: 1, rev: "7", unchanged: true }), {
    unchanged: true,
    rev: "7",
  });
  const full = parseFeed({
    version: 1,
    rev: "8",
    state: { at: 1, ageMs: 2, body: { a: 1 } },
    recommendation: null,
  });
  assert.equal(full.unchanged, false);
  assert.equal(full.state.body.a, 1);
  assert.equal(full.recommendation, null);
  assert.throws(() => parseFeed(null), /não é um objeto/);
  assert.throws(() => parseFeed({ version: 2 }), /versão 2/);
  assert.throws(
    () => parseFeed({ version: 1, rev: "x", state: { body: "texto" } }),
    /formato inesperado/,
  );
});

test("poll: um pedido por vez, since=<rev>, unchanged mantém a idade e falhas recuam", async () => {
  const queue = [],
    timers = [],
    delays = [],
    asked = [],
    updates = [];
  let clock = 1000;
  const answers = [
    () => ({ version: 1, rev: "a", state: null, recommendation: null }),
    () => ({ version: 1, rev: "a", unchanged: true }),
    () => {
      throw new Error("sem rede");
    },
    () => {
      throw new Error("sem rede");
    },
    () => ({ version: 1, rev: "b", state: null, recommendation: null }),
  ];
  const poller = startPolling({
    fetchFeed: async (since) => {
      asked.push(since);
      return answers[asked.length - 1]();
    },
    onUpdate: (u) => updates.push({ ...u, feed: u.feed && { ...u.feed } }),
    now: () => clock,
    schedule: (fn, ms) => {
      delays.push(ms);
      queue.push(fn);
      return queue.length;
    },
    cancel: (id) => timers.push(id),
  });
  for (let i = 0; i < answers.length; i++) {
    clock += 1000;
    await queue.shift()();
  }
  // Depois de uma falha o `since` é descartado (o servidor pode ter reiniciado e reiniciado os contadores de `rev`).
  assert.deepEqual(asked, [null, "a", "a", null, null]);
  assert.deepEqual(delays, [0, 1000, 1000, 2000, 4000, 1000]);
  assert.deepEqual(
    updates.map((u) => [u.failures, u.feed?.rev ?? null, u.receivedAt]),
    [
      [0, "a", 2000],
      [0, "a", 2000], // unchanged: o cache continua com a hora em que chegou
      [1, "a", 2000],
      [2, "a", 2000],
      [0, "b", 6000],
    ],
  );
  assert.equal(updates[2].error.message, "sem rede");
  assert.equal(updates[4].error, null);
  poller.stop();
  assert.equal(timers.length, 1);
});

/** Texto visível de um HTML: sem marcas, sem os nomes que só leitor de tela lê (`.sr`, `.rt-name`). */
const visibleText = (html) =>
  html
    .replace(/<b class="sr">.*?<\/b>/g, " ")
    .replace(/<span class="rt-name">.*?<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ");

test("desenho: nenhum nome de campeão ou de item aparece só em texto", () => {
  const v = viewOf(feedOf(liveInput())),
    html = ["items", "builds", "plan", "roll"]
      .map((k) => draw[k](v))
      .join("\n");
  const names = new Set();
  for (const r of v.items.next) names.add(r.unit.name).add(r.item.name);
  for (const r of v.items.next) for (const p of r.parts) names.add(p.name);
  for (const b of v.builds) {
    names.add(b.name);
    for (const i of [...b.equipped, ...b.wanted]) names.add(i.name);
  }
  const known = [...catalog.champions.values(), ...catalog.items.values()];
  const withIcon = new Set(known.filter((x) => x.icon).map((x) => x.name));
  const text = visibleText(html);
  const checked = [...names].filter((n) => withIcon.has(n));
  assert.ok(checked.length >= 6, "o caso cobre campeões e itens do catálogo");
  for (const n of checked)
    assert.ok(!text.includes(n), `${n} aparece só como texto`);
  assert.match(html, /<img /);
  assert.match(html, /Receita de Sunfire Cape/);
  assert.match(html, /data-state="missing"/);
  assert.match(html, /data-state="bank"/);
});

test("desenho: todo texto vindo do servidor é escapado", () => {
  const input = liveInput();
  input.rec.recommendations[0].strategy.panels.rolling.call.reason =
    '<img src=x onerror="boom()"> & mais';
  const v = viewOf(feedOf(input)),
    html = draw.roll(v);
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&amp; mais/);
  // Estados sem plano e a faixa também são só texto escapado.
  assert.match(draw.message(viewOf(null)), /conectando ao helper/);
  assert.match(
    draw.bar(viewOf(feedOf(liveInput()), { offline: true })),
    /sem resposta do servidor/,
  );
  assert.equal(draw.roll(viewOf(feedOf({ state: liveInput().state }))), "");
});

/* ---------- Fronteiras da página ---------- */

const hudDir = path.join(root, "overlay", "hud");
const hudFiles = fs.readdirSync(hudDir).filter((f) => f.endsWith(".mjs"));

test("página: tudo que o HUD carrega, resolvido como URL, é servido pelo servidor", () => {
  const seen = new Set(),
    queue = ["/overlay/hud.mjs"];
  const html = fs.readFileSync(path.join(hudDir, "index.html"), "utf8");
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g))
    queue.push(new URL(ref, "http://helper/overlay/index.html").pathname);
  assert.ok(queue.includes("/overlay/hud.css"));
  assert.ok(queue.includes("/v2/css/tokens.css"));
  while (queue.length) {
    const url = queue.pop();
    if (seen.has(url)) continue;
    seen.add(url);
    const hit = staticTarget(root, url);
    assert.ok(hit?.type, `${url}: o servidor não serve este arquivo`);
    assert.ok(fs.existsSync(hit.target), `${url}: arquivo não existe`);
    if (!/\.(mjs|js)$/.test(url)) continue;
    for (const spec of importsOf(
      path.relative(root, hit.target).replace(/\\/g, "/"),
    )) {
      assert.ok(
        spec.startsWith(".") || spec.startsWith("/"),
        `${url}: import de pacote/node no navegador (${spec})`,
      );
      queue.push(new URL(spec, `http://helper${url}`).pathname);
    }
  }
  for (const f of hudFiles)
    assert.ok(
      seen.has(`/overlay/${f}`) || f === "index.html",
      `${f} não é carregado por ninguém`,
    );
});

test("página: o modelo de tela, a consulta e o desenho não importam nada (dependências por injeção)", () => {
  for (const f of ["view.mjs", "poll.mjs", "draw.mjs"])
    assert.deepEqual(importsOf(`overlay/hud/${f}`), [], f);
});

test("página: só lê /api/overlay; nunca pede análise nem estado, nem escreve no servidor", () => {
  for (const f of hudFiles) {
    const code = stripNonCode(read(`overlay/hud/${f}`), { keepStrings: true });
    assert.ok(
      !/\/api\/(?:recommend|state)\b/.test(code),
      `${f}: pede ${code.match(/\/api\/\w+/)?.[0]}`,
    );
    assert.ok(
      !/method\s*:\s*["'](?:POST|PUT|DELETE|PATCH)/i.test(code),
      `${f}: escreve no servidor`,
    );
  }
  const code = stripNonCode(read("overlay/hud/hud.mjs"), { keepStrings: true });
  assert.match(code, /\/api\/overlay/);
});
