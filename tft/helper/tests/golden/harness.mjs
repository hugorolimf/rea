// Harness golden do pipeline de recomendação (M0 da migração, ver ARQUITETURA.md).
//
// Roda, offline e sem rede, a MESMA sequência que `POST /api/recommend` executa (app/recommend.mjs): montagem de
// `options`, a base, a tática e os planos (fatos do grafo, app/recommend-facts.mjs: os mesmos que o servidor usa, com o
// mesmo histórico por conteúdo), plano em andamento, aprimoramentos, disputa e tabuleiro visto. É uma TRANSCRIÇÃO do
// trecho de app/recommend.mjs (que depende de estado e de E/S do servidor): `tests/golden.test.mjs` confere que a
// ordem das chamadas continua igual (o emblema de aprimoramento é o fato `traits.grants`, de core/catalog/traits.mjs).
//
// O relógio é injetado (`now`), a evidência vem de um subconjunto congelado (fixtures/evidence.json) e a simulação de
// rolagem usa semente fixa: a saída é determinística. Nada aqui lê `data/`; isso é feito só por scripts/golden-freeze.mjs.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { augmentAdvice } from "../../augment-advice.mjs";
import { contestAlert } from "../../contest.mjs";
import { teamCode } from "../../team-code.mjs";
import { factKey, planTracker } from "../../plan-state.mjs";
import { gepBenchUnits } from "../../gep-reader.mjs";
import { analysisInputs } from "../../core/state/inputs.mjs";
import { recommendInventory } from "../../item-holdings.mjs";
import { loadComps } from "../../meta-comps.mjs";
import { loadMeta } from "../../meta-builds.mjs";
import { loadStats } from "../../meta-stats.mjs";
import { loadAugmentStats } from "../../augment-stats.mjs";
import {
  MAX_PLANS,
  bindRun,
  composeAnalysis,
  createRecommendGraph,
  plansOf,
  recommendValues,
} from "../../app/recommend-facts.mjs";
import { filterKey } from "../../evidence.mjs";
import {
  emblemTraitMap,
  traitBook,
  traitsWithEmblems,
} from "../../core/catalog/traits.mjs";

export const HERO_ID = "47445859";
export const SET = "TFTSet18";
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const goldenDir = path.dirname(fileURLToPath(import.meta.url));
export const fixturesDir = path.join(goldenDir, "fixtures");
export const expectedDir = path.join(goldenDir, "expected");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export const sha256 = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Tudo o que o pipeline lê e que não muda por cenário: catálogo, cópias de meta CONGELADAS em fixtures/meta (as da raiz
 * são regravadas pelo servidor a cada atualização), evidência congelada e as tabelas estáticas do projeto.
 * `evidence`/`conditional` podem ser trocados (o congelamento usa o cache inteiro do disco).
 */
export async function loadContext({
  evidence = null,
  conditional = null,
} = {}) {
  const metaDir = path.join(fixturesDir, "meta"),
    catalog = readJson(path.join(root, "catalog.json")),
    frozen =
      evidence && conditional
        ? null
        : readJson(path.join(fixturesDir, "evidence.json"));
  const augmentList = readJson(path.join(root, "augments.json")).augments ?? [];
  return {
    catalog,
    metaComps: await loadComps(metaDir, SET, catalog),
    meta: await loadMeta(metaDir, SET),
    boardStats: await loadStats(metaDir, SET),
    augmentStats: await loadAugmentStats(metaDir),
    augmentList,
    augmentById: new Map(augmentList.map((a) => [a.id, a])),
    localNames: readJson(path.join(root, "names-pt_br.json")).names ?? {},
    plannerCatalog: readJson(path.join(root, "teamplanner-catalog.json")).data[
      SET
    ],
    evidence: evidence ?? new Map(Object.entries(frozen.total)),
    conditional: conditional ?? new Map(Object.entries(frozen.conditional)),
    digests: {
      catalog: sha256(path.join(root, "catalog.json")),
      augments: sha256(path.join(root, "augments.json")),
    },
  };
}

/** Aprimoramento que dá emblema: a regra única do núcleo (M9; antes era uma cópia de server.mjs conferida por texto). */
export const makeAugmentEmblem = (catalog) => traitBook(catalog).augmentEmblem;

/** Entrada do cliente com os mesmos padrões de `validate` em server.mjs. */
export function clientInput(input = {}) {
  return {
    compSwaps: input.compSwaps ?? {},
    replayGameId: input.replayGameId ?? "",
    goalCompId: input.goalCompId ?? "",
    goalSwaps: input.goalSwaps ?? [],
    augments: input.augments ?? [],
    augmentsKnown: input.augmentsKnown === true,
    level: input.level,
    gold: input.gold === undefined ? null : input.gold,
    bench: [],
    inventory: input.inventory ?? [],
    previewIds: input.previewIds ?? [],
    side: input.side ?? "right",
    targetLevel: input.targetLevel ?? "auto",
    goalCarryId: input.goalCarryId ?? "",
    levelEstimated: input.levelEstimated === true,
    levelSource: input.levelSource ?? "lido",
    playerId: input.playerId ?? "",
    viewedPlayerId: input.viewedPlayerId ?? "",
  };
}

const NO_TIMER = (label, fn) => fn();

/**
 * A montagem de uma leitura (o começo de um POST /api/recommend, até as entradas do grafo): `options`, o estado lido, a
 * comp fixada, os aprimoramentos escolhidos e `values` (as entradas dos fatos, de `recommendValues`). `run` acumula o
 * que o servidor mantém entre chamadas; `step`: { snapshot, metadata, client, seen, hidden, streak, trend, now }.
 * Separada de `runStep` para os testes de invalidação (tests/recommend-graph.test.mjs) mudarem uma entrada de cada vez.
 */
export function assembleStep(ctx, run, step) {
  const { catalog, metaComps, meta, boardStats, augmentStats, augmentById } =
    ctx;
  const snapshot = structuredClone(step.snapshot),
    metadata = {
      actionable: true,
      phase: "InProgress",
      sameGame: true,
      gameId: snapshot.gameId,
      set: SET,
      ...step.metadata,
    };
  const options = clientInput(step.client);
  // Partida revista: a leitura de tela é da partida de agora e não vale para ela (server.mjs).
  // Ao vivo, ouro e nível saem do estado do servidor (M7). Os cenários os declaram em `client` (herança do payload antigo,
  // em que o cliente os mandava); aqui viram a leitura do servidor, que dá a mesma entrada para a análise.
  const seen = options.replayGameId
    ? {}
    : {
        ...step.seen,
        level: options.levelEstimated ? null : options.level,
        gold: options.gold,
        sources: {
          level: options.levelSource === "derivado" ? "derived" : "gep",
        },
      };
  // Luva de Ladrão: só a luva é um item real (server.mjs, antes de tudo).
  for (const p of snapshot.statsBlock.players)
    for (const u of p.boardPieces ?? [])
      if ((u.itemNames ?? []).some((i) => /ThiefsGloves/.test(i)))
        u.itemNames = u.itemNames.filter((i) => /ThiefsGloves/.test(i));
  options.playerId = HERO_ID;
  const goal = options.goalCompId
    ? (metaComps.comps.find((c) => c.id === options.goalCompId) ?? null)
    : null;
  if (goal) {
    const units = goal.units.filter(
      (id) =>
        !catalog.champions
          .find((c) => c.apiName === id)
          ?.traits.includes("Avatar"),
    );
    options.goalSwaps = options.goalSwaps.filter(
      (s) =>
        s.out !== goal.carry && units.includes(s.out) && !units.includes(s.in),
    );
    for (const s of options.goalSwaps)
      units.splice(units.indexOf(s.out), 1, s.in);
    options.previewIds = units;
    options.goalCarryId = options.previewIds.includes(goal.carry)
      ? goal.carry
      : "";
  }
  const itemIds = new Set(catalog.items.map((i) => i.apiName));
  options.bench = gepBenchUnits(seen, HERO_ID);
  options.benchKnown = !options.replayGameId && seen.sources?.bench === "gep";
  options.inventory = recommendInventory(
    options.replayGameId ? options.inventory : [],
    seen,
    (id) => itemIds.has(id),
  );
  options.bankRead =
    !options.replayGameId &&
    (Array.isArray(seen.items) || options.inventory.length > 0);
  Object.assign(
    options,
    analysisInputs(seen, {
      augments: options.augments,
      // Nível só estimado: o cenário dizia o nível em `client.level` com `levelEstimated` (o tabuleiro).
      estimatedLevel: options.levelEstimated ? options.level : null,
      live: !options.replayGameId,
    }),
  );
  const chosen = options.augments
      .map((id) => augmentById.get(id))
      .filter(Boolean),
    book = traitBook(catalog);
  options.sticky = options.replayGameId
    ? null
    : run.tracker.sticky(metadata.gameId);
  // O fato lido (plan-state.mjs factKey): o desafiante só é liberado num fato novo.
  const fact = factKey({
    stage: seen.stage ?? null,
    level: options.level,
    gold: options.gold,
    shop: options.shop,
    board:
      snapshot.statsBlock.players.find((p) => String(p.playerId) === HERO_ID)
        ?.boardPieces ?? [],
    bench: options.bench,
    inventory: options.inventory,
    augments: options.augments,
  });
  options.holdPlan =
    !options.replayGameId && run.tracker.holdFor(metadata.gameId, fact);
  options.streak = options.replayGameId ? null : (step.streak ?? null);
  options.trend = options.replayGameId ? null : (step.trend ?? null);
  options.hidden = step.hidden ?? {};
  options.augmentStats = augmentStats;
  // Os fatos do pipeline (app/recommend-facts.mjs): `recommendValues` traduz `options` + cópias de meta em entradas do
  // grafo. A escolha de nível-alvo ("auto" ou um nível) vai como veio do cliente.
  const values = recommendValues({
    snapshot,
    catalog,
    options,
    meta,
    metaComps,
    boardStats,
    augmentStats,
    chosen,
    goal,
    targetLevel: options.targetLevel,
  });
  return {
    snapshot,
    metadata,
    options,
    seen,
    goal,
    chosen,
    book,
    values,
    fact,
  };
}

/**
 * Uma execução do pipeline (um POST /api/recommend). `run` acumula o que o servidor mantém entre chamadas:
 * `tracker` (plano em andamento) e `graph` (os fatos memoizados, como o servidor).
 */
export function runStep(ctx, run, step, { time = NO_TIMER } = {}) {
  const { catalog, metaComps, meta, augmentById } = ctx;
  const { snapshot, metadata, options, seen, chosen, book, values, fact } =
    assembleStep(ctx, run, step);
  // Cada leitura reafirma todas as entradas e lê o fato no mesmo trecho síncrono (bindRun).
  const graph = run.fresh ? createRecommendGraph(run.graphOptions) : run.graph;
  const view = bindRun(graph, values, () => evidenceInputs(run));
  const target = view.target();
  options.targetLevel = target.level;
  time("analyze", () => {
    let fresh = view.base();
    // O servidor busca as perguntas abertas e refaz a análise (até 3 passes). Offline, o que não está na evidência
    // congelada responde como a rede indisponível (null: a análise segue sem ela), então a base converge.
    for (
      let pass = 0;
      pass < 3 &&
      (fresh.conditionalRequests.length || fresh.evidenceRequests.length);
      pass++
    ) {
      for (const f of fresh.conditionalRequests)
        if (!run.conditional.has(f)) {
          run.conditional.set(f, null);
          run.evidenceVersion++;
        }
      for (const f of fresh.evidenceRequests)
        if (!run.evidence.has(filterKey(f))) {
          run.evidence.set(filterKey(f), null);
          run.evidenceVersion++;
        }
      fresh = view.base();
    }
    return fresh;
  });
  const tactical = time("tactics", () => view.tactical());
  const planCount = plansOf(tactical).length;
  if (planCount > MAX_PLANS)
    throw Error(`${planCount} planos; o grafo tem fatos para ${MAX_PLANS}.`);
  const perPlan = [];
  for (let slot = 0; slot < planCount; slot++)
    perPlan.push({
      stage: time("stagePlan", () => view.field(slot)),
      strategy: time("strategy", () => view.strategy(slot)),
    });
  const analysis = time("clone", () =>
    composeAnalysis(tactical, perPlan, (ids) =>
      teamCode(ids, ctx.plannerCatalog),
    ),
  );
  analysis.currentLevel = options.level;
  let switched = null;
  if (
    !options.replayGameId &&
    analysis.self.health > 0 &&
    (analysis.recommendations[0]?.meta || analysis.recommendations[0]?.freeId)
  ) {
    const top = analysis.recommendations[0];
    const tracked = time("planTrack", () =>
      run.tracker.track({
        gameId: metadata.gameId,
        stage: seen.stage ?? null,
        level: options.level,
        targetLevel: options.targetLevel,
        gold: options.gold,
        top,
        shown: analysis.preview ?? top,
        analysis,
        chosen: chosen.map((a) => ({ id: a.id, name: a.name })),
        ledger: step.ledger ?? null,
        baseId: view.readingId(),
        fact,
        pinned: !!analysis.preview,
      }),
    );
    switched = tracked.switched;
    analysis.planProgress = tracked.progress;
  }
  analysis.chosenAugments = chosen.map((a) => ({
    id: a.id,
    name: a.name,
    desc: a.desc,
    traits: a.traits.map((t) => book.nameOf(t)).filter(Boolean),
  }));
  options.chosenAugments = chosen;
  analysis.augmentAdvice = time("augmentAdvice", () =>
    augmentAdvice(
      options.augmentIds.map((id) => augmentById.get(id)).filter(Boolean),
      analysis.preview ?? analysis.recommendations[0],
      analysis,
      catalog,
      options,
      ctx.localNames,
    ),
  );
  analysis.contest = time("contest", () =>
    contestAlert({
      plan: analysis.preview ?? analysis.recommendations[0],
      opponents: analysis.opponents,
      ranking: analysis.compRanking ?? [],
      comps: metaComps.comps,
      mine: analysis.self.units.map((u) => u.championName),
      stage: options.stage,
    }),
  );
  analysis.buildSource = meta.builds.size
    ? {
        label: meta.label,
        fetchedAt: meta.fetchedAt,
        url: "https://www.metatft.com/",
      }
    : null;
  analysis.targetLevel = options.targetLevel;
  analysis.targetLevelAuto = target.auto;
  analysis.targetLevelReasons = target.reasons;
  analysis.levelEstimated = options.levelEstimated;
  analysis.levelSource = options.levelSource;
  const emblemTraits = emblemTraitMap(
    catalog.items,
    new Map(catalog.traits.map((t) => [t.name, t.apiName])).keys(),
  );
  const viewed = snapshot.statsBlock.players.find(
    (p) => String(p.playerId) === options.viewedPlayerId,
  );
  if (options.viewedPlayerId && !viewed)
    throw Error("Adversário não encontrado nesta partida.");
  const viewedBoard = viewed
    ? {
        playerId: String(viewed.playerId),
        name: viewed.riotIdGameName ?? viewed.summonerName,
        isSelf: String(viewed.playerId) === HERO_ID,
        units: viewed.boardPieces.map((u) => {
          const c = catalog.champions.find((c) => c.apiName === u.championName);
          const t = traitsWithEmblems(c?.traits, u.itemNames, emblemTraits);
          return {
            ...u,
            name: c?.name ?? u.championName,
            traits: t.traits,
            emblemTraits: t.added,
          };
        }),
      }
    : null;
  const response = time("json", () =>
    JSON.parse(JSON.stringify({ metadata, ...analysis, viewedBoard })),
  );
  return { response, switched, bytes: JSON.stringify(response).length };
}

/**
 * Estado que o servidor mantém entre chamadas, recriado a cada cenário: o plano em andamento, as respostas do explorer
 * e o grafo de fatos (o histórico por conteúdo faz o papel do cache da base). `opts.fresh`: cada leitura usa um grafo novo
 * (sem histórico: tudo recalcula); `opts.overrides`: fatos que substituem os do pipeline pelo id (o espião do teste D1); `opts.verify`: o modo de teste do grafo
 * (cada fato roda duas vezes, a saída é congelada e a mutação de entrada acusa `IMPURE`).
 */
export function newRun(ctx, now = 0, opts = {}) {
  let t = now;
  const graphOptions = {
      overrides: opts.overrides ?? [],
      verify: opts.verify === true,
    },
    cloneMap = ctx.cloneMap ?? ((m) => new Map(m));
  return {
    tracker: planTracker({ file: null, now: () => t }),
    graph: createRecommendGraph(graphOptions),
    graphOptions,
    fresh: opts.fresh === true,
    // Respostas do explorer: o servidor as acumula entre chamadas; aqui cada cenário parte do congelado.
    evidence: cloneMap(ctx.evidence),
    conditional: cloneMap(ctx.conditional),
    // A mesma cópia serve às cópias que o grafo recebe (scripts/golden-freeze.mjs põe um espião de leituras nos mapas).
    cloneMap,
    // Muda a cada resposta nova dos mapas acima (o grafo recebe cópias: as entradas são imutáveis).
    evidenceVersion: 0,
    evidenceCopy: { version: -1, evidence: null, conditional: null },
    advance: (ms) => (t += ms),
    clock: () => t,
  };
}

/** Cópias dos mapas do explorer para o grafo, refeitas só quando mudaram. */
export function evidenceInputs(run) {
  if (run.evidenceCopy.version !== run.evidenceVersion)
    run.evidenceCopy = {
      version: run.evidenceVersion,
      evidence: run.cloneMap(run.evidence),
      conditional: run.cloneMap(run.conditional),
    };
  return {
    evidence: run.evidenceCopy.evidence,
    conditional: run.evidenceCopy.conditional,
  };
}

/** Passos de um cenário já combinados com os do anterior (cada passo altera só o que declara). */
export function resolveSteps(ctx, scenario, snapshots) {
  const r = (v) => (typeof v === "function" ? v(ctx) : v);
  let cur = {
    snapshot: scenario.snapshot,
    metadata: scenario.metadata ?? {},
    client: r(scenario.client) ?? {},
    seen: r(scenario.seen) ?? {},
    streak: scenario.streak ?? null,
    trend: scenario.trend ?? null,
    ledger: null,
  };
  const out = [];
  for (const raw of scenario.steps ?? [{}]) {
    const patch = r(raw) ?? {};
    cur = {
      ...cur,
      ...patch,
      client: { ...cur.client, ...r(patch.client) },
      seen: { ...cur.seen, ...r(patch.seen) },
      metadata: { ...cur.metadata, ...patch.metadata },
    };
    out.push(cur);
  }
  return out.map((s) => {
    if (!snapshots.has(s.snapshot))
      throw Error(`Snapshot congelado ausente: ${s.snapshot}`);
    return {
      ...s,
      snapshot: snapshots.get(s.snapshot),
      hidden: snapshots.hidden.get(s.snapshot) ?? {},
    };
  });
}

/** Snapshots congelados (fixtures/snapshots/*.json) e o banco oculto de rivais gravado com cada um. */
export function loadSnapshots() {
  const dir = path.join(fixturesDir, "snapshots"),
    map = new Map();
  map.hidden = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const name = f.replace(/\.json$/, ""),
      data = readJson(path.join(dir, f));
    map.set(name, data.snapshot);
    map.hidden.set(name, data.hidden ?? {});
  }
  return map;
}

/** Executa um cenário inteiro (todos os passos, em ordem, com o mesmo estado de servidor). */
export function runScenario(ctx, scenario, snapshots, opts = {}) {
  // `noBaseCache`: cada leitura recalcula tudo (um grafo novo por leitura, sem histórico); `overrides`: ver `newRun`.
  const run = newRun(ctx, Date.parse("2026-10-10T20:00:00Z"), {
      fresh: opts.noBaseCache === true,
      overrides: opts.overrides,
      verify: opts.verify,
    }),
    steps = resolveSteps(ctx, scenario, snapshots),
    out = [];
  for (const step of steps) {
    out.push(runStep(ctx, run, step, opts));
    run.advance(30_000);
  }
  return out;
}

/* ---------- Normalização e comparação ---------- */

const DECIMALS = 1e9;

/**
 * Forma canônica de uma resposta: o que o cliente receberia em JSON, chaves ordenadas e decimais arredondados em 1e-9
 * (diferença de último bit entre plataformas não é regressão). Só isso; nada de remover campos.
 */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  if (typeof value === "number" && Number.isFinite(value))
    return Number.isInteger(value)
      ? value
      : Math.round(value * DECIMALS) / DECIMALS;
  return value;
}

/** Diferenças entre dois valores canônicos como linhas "caminho: antes -> depois" (até `limit`). */
export function diffPaths(a, b, limit = 40) {
  const out = [];
  const show = (v) => {
    const s = JSON.stringify(v);
    return s === undefined
      ? "ausente"
      : s.length > 90
        ? s.slice(0, 87) + "..."
        : s;
  };
  const walk = (x, y, at) => {
    if (out.length >= limit) return;
    if (
      x &&
      y &&
      typeof x === "object" &&
      typeof y === "object" &&
      Array.isArray(x) === Array.isArray(y)
    ) {
      const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
      for (const k of keys) walk(x[k], y[k], at ? `${at}.${k}` : k);
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y))
      out.push(`${at}: ${show(x)} -> ${show(y)}`);
  };
  walk(a, b, "");
  return out;
}

/** Serialização estável dos arquivos esperados: uma linha por chave de topo (diffs de git ficam localizáveis). */
export function serialize(doc) {
  const lines = Object.keys(doc).map(
    (k) => `${JSON.stringify(k)}:${JSON.stringify(doc[k])}`,
  );
  return `{\n${lines.join(",\n")}\n}\n`;
}

export const expectedFile = (id) => path.join(expectedDir, `${id}.json.gz`);

/** Esperado de um cenário (gzip: cada resposta tem ~1 MB), ou null se ainda não existe. */
export function readExpected(id) {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(expectedFile(id))));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/** Grava o esperado só se o conteúdo mudou (o gzip não precisa ser idêntico byte a byte entre versões do Node). */
export function writeExpected(id, doc) {
  const text = serialize(doc),
    file = expectedFile(id);
  try {
    if (zlib.gunzipSync(fs.readFileSync(file)).toString("utf8") === text)
      return false;
  } catch {}
  fs.mkdirSync(expectedDir, { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(text, { level: 9 }));
  return true;
}
