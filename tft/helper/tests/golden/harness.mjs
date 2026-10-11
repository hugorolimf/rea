// Harness golden do pipeline de recomendação (M0 da migração, ver ARQUITETURA.md).
//
// Roda, offline e sem rede, a MESMA sequência que `POST /api/recommend` executa em server.mjs: montagem de `options`,
// `analyze` (com cache da base como o servidor), `tactics`, `playbook`/`stagePlan`/`strategy` por plano, plano em
// andamento, aprimoramentos, decisão, disputa e tabuleiro visto. É uma TRANSCRIÇÃO do trecho de server.mjs (que é
// transporte e não exporta o pipeline): enquanto o pipeline não sai do servidor (M9), `tests/golden.test.mjs`
// confere que a ordem das chamadas e `augmentEmblem` continuam iguais às do servidor.
//
// O relógio é injetado (`now`), a evidência vem de um subconjunto congelado (fixtures/evidence.json) e a simulação de
// rolagem usa semente fixa: a saída é determinística. Nada aqui lê `data/`; isso é feito só por scripts/golden-freeze.mjs.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { analyze } from "../../engine.mjs";
import { tactics } from "../../tactics.mjs";
import { playbook } from "../../playbook.mjs";
import { stagePlan } from "../../stage.mjs";
import { strategy } from "../../strategy.mjs";
import { decide } from "../../decision.mjs";
import { augmentAdvice } from "../../augment-advice.mjs";
import { contestAlert } from "../../contest.mjs";
import { suggestTargetLevel } from "../../target-level.mjs";
import { teamCode } from "../../team-code.mjs";
import { planTracker } from "../../plan-state.mjs";
import { gepBenchUnits } from "../../gep-reader.mjs";
import { recommendInventory } from "../../item-holdings.mjs";
import { loadComps } from "../../meta-comps.mjs";
import { loadMeta } from "../../meta-builds.mjs";
import { loadStats } from "../../meta-stats.mjs";
import { loadAugmentStats } from "../../augment-stats.mjs";
import {
  baseId as baseIdOf,
  baseInputs as baseInputsOf,
  snapshotSignature,
} from "../../analysis-keys.mjs";
import { filterKey } from "../../evidence.mjs";
import {
  emblemTraitMap,
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

/** Aprimoramento que dá emblema (transcrição de server.mjs:augmentEmblem; o teste confere o texto). */
export function makeAugmentEmblem(catalog) {
  const traitApiByName = new Map(
    catalog.traits.map((t) => [t.name, t.apiName]),
  );
  return function augmentEmblem(a) {
    if (!a.id.startsWith("DA_")) return null;
    const named = /^(.+) (?:Crest|Crown|Circlet|Emblem)$/.exec(
        a.nameEn ?? "",
      )?.[1],
      given = /Recebe um Emblema de (.+?)[.,]/.exec(a.desc ?? "")?.[1],
      trait =
        traitApiByName.get(named) ??
        traitApiByName.get(given) ??
        (given && a.traits.length === 1 ? a.traits[0] : null),
      name = catalog.traits.find((t) => t.apiName === trait)?.name,
      item = name
        ? catalog.items.find(
            (i) =>
              i.name === `${name} Emblem` &&
              i.apiName.startsWith("DA_") &&
              !i.apiName.endsWith("Augment"),
          )?.apiName
        : null;
    return trait ? { trait, item: item ?? null } : null;
  };
}

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
    levelSource: input.levelSource ?? "tela",
    playerId: input.playerId ?? "",
    viewedPlayerId: input.viewedPlayerId ?? "",
  };
}

const NO_TIMER = (label, fn) => fn();

/**
 * Uma execução do pipeline (um POST /api/recommend). `run` acumula o que o servidor mantém entre chamadas:
 * `tracker` (plano em andamento), `baseCache` (análise base por entrada, como `baseAnalysisCache`).
 * `step`: { snapshot, metadata, client, seen, hidden, streak, trend, now }.
 */
export function runStep(
  ctx,
  run,
  step,
  { time = NO_TIMER, observeOptions = null } = {},
) {
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
  const seen = options.replayGameId ? {} : (step.seen ?? {});
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
  options.inventory = recommendInventory(options.inventory, seen, (id) =>
    itemIds.has(id),
  );
  options.bankRead =
    !options.replayGameId &&
    (Array.isArray(seen.items) || options.inventory.length > 0);
  options.shop = (seen.shop ?? []).map((card) => card?.id ?? null);
  options.augmentIds = (seen.augments ?? []).some((id) =>
    options.augments.includes(id),
  )
    ? []
    : (seen.augments ?? []);
  options.xp = seen.xp;
  options.removers = seen.removers === 0 ? 0 : null;
  options.hasRemover = (seen.removers ?? 0) > 0;
  const stageRead = /^(\d)-(\d)$/.exec(seen.stage ?? "");
  options.stage = stageRead
    ? { stage: Number(stageRead[1]), round: Number(stageRead[2]) }
    : null;
  const chosen = options.augments
      .map((id) => augmentById.get(id))
      .filter(Boolean),
    traitNameByApi = new Map(catalog.traits.map((t) => [t.apiName, t.name])),
    augmentEmblem = makeAugmentEmblem(catalog);
  const emblemOf = new Map(chosen.map((a) => [a.id, augmentEmblem(a)])),
    traitsOfAug = (a) => [
      ...new Set([...a.traits, emblemOf.get(a.id)?.trait].filter(Boolean)),
    ];
  options.augmentTraits = [
    ...new Set(
      chosen.flatMap((a) =>
        traitsOfAug(a)
          .map((t) => traitNameByApi.get(t))
          .filter(Boolean),
      ),
    ),
  ];
  options.augmentTraitsById = Object.fromEntries(
    chosen.map((a) => [a.id, traitsOfAug(a)]),
  );
  options.augmentNames = Object.fromEntries(chosen.map((a) => [a.id, a.name]));
  options.sticky = options.replayGameId
    ? null
    : run.tracker.sticky(metadata.gameId);
  options.stickyCompId = options.sticky?.id ?? null;
  options.holdPlan =
    !options.replayGameId && run.tracker.holdFor(metadata.gameId);
  options.streak = options.replayGameId ? null : (step.streak ?? null);
  options.trend = options.replayGameId ? null : (step.trend ?? null);
  options.hidden = step.hidden ?? {};
  const signature = snapshotSignature(snapshot);
  options.metaComps = metaComps.comps.map((c) => {
    const list = (options.compSwaps[c.id] ?? []).filter(
      (x) =>
        x.out !== c.carry && c.units.includes(x.out) && !c.units.includes(x.in),
    );
    if (!list.length) return c;
    const units = [...c.units];
    for (const x of list) units.splice(units.indexOf(x.out), 1, x.in);
    return { ...c, units, appliedSwaps: list };
  });
  options.metaBuilds = meta.builds;
  options.metaRoles = meta.roles;
  options.metaLabel = meta.label;
  let targetAuto = null;
  if (options.targetLevel === "auto") {
    targetAuto = suggestTargetLevel(
      snapshot,
      HERO_ID,
      options.level,
      options.gold,
    );
    options.targetLevel = targetAuto.level;
  }
  options.baseAvg = boardStats?.base?.[0] ?? 4.466;
  options.stats = boardStats;
  options.itemStats = meta.items ?? {};
  options.augmentStats = augmentStats;
  options.augmentEmblems = chosen
    .map((a) => emblemOf.get(a.id)?.item)
    .filter(Boolean);
  options.conditional = run.conditional;
  options.evidence = run.evidence;
  const baseInputs = baseInputsOf(options, {
    source: signature,
    builds: meta.fetchedAt,
    comps: metaComps.fetchedAt,
    stats: boardStats?.fetchedAt ?? null,
  });
  // Mesmo critério do servidor: base só é guardada sem perguntas abertas; versão da evidência constante offline.
  const baseKey = `0|${baseInputs}`;
  let built = run.baseCache.get(baseKey);
  if (!built) {
    built = time("analyze", () => {
      // `observeOptions` embrulha `options` só para `analyze` (o teste de arquitetura registra o que a base lê).
      const observed = observeOptions ? observeOptions(options) : options;
      let fresh = analyze(snapshot, catalog, observed);
      // O servidor busca as perguntas abertas e refaz a análise (até 3 passes). Offline, o que não está na evidência
      // congelada responde como a rede indisponível (null: a análise segue sem ela), então a base converge.
      for (
        let pass = 0;
        pass < 3 &&
        (fresh.conditionalRequests.length || fresh.evidenceRequests.length);
        pass++
      ) {
        for (const f of fresh.conditionalRequests)
          if (!run.conditional.has(f)) run.conditional.set(f, null);
        for (const f of fresh.evidenceRequests)
          if (!run.evidence.has(filterKey(f)))
            run.evidence.set(filterKey(f), null);
        fresh = analyze(snapshot, catalog, observed);
      }
      return fresh;
    });
    if (!built.conditionalRequests.length && !built.evidenceRequests.length)
      run.baseCache.set(baseKey, built);
  }
  const base = time("clone", () => structuredClone(built));
  if (base.previewGrow.length)
    options.previewIds = [
      ...options.previewIds,
      ...base.previewGrow.map((g) => g.id),
    ];
  options.goalComp = goal;
  const analysis = time("tactics", () => tactics(base, catalog, options));
  analysis.goalIds = base.previewGrow.length ? options.previewIds : null;
  analysis.goal = options.goalCompId
    ? { id: options.goalCompId, found: !!goal, swaps: options.goalSwaps }
    : null;
  const shownId = analysis.recommendations[0]?.meta?.id;
  analysis.autoSwaps = goal
    ? []
    : (options.metaComps.find((c) => c.id === shownId)?.appliedSwaps ?? []);
  if (analysis.preview) analysis.preview.flex = base.previewFlex ?? [];
  const ranked = goal
    ? analysis.compRanking?.find((r) => r.id === goal.id)
    : null;
  if (goal && analysis.preview)
    Object.assign(analysis.preview, {
      emblems: ranked?.emblem ?? [],
      evidence: ranked?.evidence ?? null,
      title: goal.title,
      meta: {
        id: goal.id,
        tier: goal.tier,
        avg: goal.avg,
        top4: goal.top4,
        win: goal.win,
        games: goal.games,
        levelling: goal.levelling,
        rerollLevel: goal.rerollLevel,
        stars3: goal.stars3,
        builds: goal.builds,
      },
    });
  for (const plan of [
    ...analysis.recommendations,
    ...(analysis.preview ? [analysis.preview] : []),
  ]) {
    plan.playbook = time("playbook", () =>
      playbook(plan, analysis, options, metadata),
    );
    plan.stage = time("stagePlan", () =>
      stagePlan(plan, analysis, catalog, options),
    );
    plan.strategy = time("strategy", () => strategy(plan, analysis, options));
    if (plan.playbook && metadata.actionable && analysis.self.health > 0)
      Object.assign(plan.playbook, {
        headline: plan.strategy.headline,
        style: plan.strategy.style || plan.playbook.style,
        actions: [...plan.strategy.steps, ...plan.strategy.reasons],
        note: "Regras de economia aplicadas a estágio, nível, XP, ouro, HP, pool e loja lidos; sequência inferida pelo HP entre rodadas. Não simula combate.",
      });
    plan.teamCode = teamCode(
      plan.board.map((u) => u.id),
      ctx.plannerCatalog,
    );
  }
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
        baseId: baseIdOf(baseInputs),
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
    traits: a.traits.map((t) => traitNameByApi.get(t)).filter(Boolean),
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
  analysis.decision = time("decide", () => decide(analysis, options));
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
  analysis.targetLevelAuto = targetAuto !== null;
  analysis.targetLevelReasons = targetAuto?.reasons ?? [];
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

/** Estado que o servidor mantém entre chamadas, recriado a cada cenário. */
export function newRun(ctx, now = 0) {
  let t = now;
  return {
    tracker: planTracker({ file: null, now: () => t }),
    baseCache: new Map(),
    // Respostas do explorer: o servidor as acumula entre chamadas; aqui cada cenário parte do congelado.
    evidence: (ctx.cloneMap ?? ((m) => new Map(m)))(ctx.evidence),
    conditional: (ctx.cloneMap ?? ((m) => new Map(m)))(ctx.conditional),
    advance: (ms) => (t += ms),
    clock: () => t,
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
  const run = newRun(ctx, Date.parse("2026-10-10T20:00:00Z")),
    steps = resolveSteps(ctx, scenario, snapshots),
    out = [];
  // `noBaseCache`: cada leitura recalcula a base (o que o servidor faria sem acerto no `baseAnalysisCache`).
  if (opts.noBaseCache) run.baseCache = { get: () => undefined, set() {} };
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
