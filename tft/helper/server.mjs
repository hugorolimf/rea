import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./engine.mjs";
import { tactics } from "./tactics.mjs";
import { captureBoards } from "./capture.mjs";
import { playbook } from "./playbook.mjs";
import { teamCode } from "./team-code.mjs";
import { suggestTargetLevel } from "./target-level.mjs";
import { loadMeta, refreshMeta, metaIsStale } from "./meta-builds.mjs";
import { decide } from "./decision.mjs";
import { stagePlan } from "./stage.mjs";
import { strategy } from "./strategy.mjs";
import { augmentAdvice } from "./augment-advice.mjs";
import { loadComps, refreshComps, compsAreStale } from "./meta-comps.mjs";
import { screenReader } from "./screen-reader.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TFT_HELPER_PORT ?? 3218);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Porta inválida.");
const icons = JSON.parse(
  await fs.readFile(path.join(root, "assets-manifest.json"), "utf8"),
);
const HERO_ID = "47445859"; // Identidade confirmada pelo usuário; independente da arena consultada.
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "catalog.json"), "utf8"),
);
const boardPath = path.join(
  os.homedir(),
  "AppData/Local/TFT/Saved/Logs/TFTEoGStats.json",
);
const plannerCatalog = JSON.parse(
  await fs.readFile(path.join(root, "teamplanner-catalog.json"), "utf8"),
).data.TFTSet18;
let meta = await loadMeta(root, "TFTSet18");
const updateMeta = () =>
  refreshMeta(root, "TFTSet18")
    .then((m) => {
      meta = m;
      console.log("Builds de meta atualizadas: " + m.label);
    })
    .catch((e) => console.log("Builds de meta não atualizadas: " + e.message));
if (metaIsStale(meta)) void updateMeta();
setInterval(
  () => {
    if (metaIsStale(meta)) void updateMeta();
  },
  30 * 60 * 1000,
).unref();
let metaComps = await loadComps(root, "TFTSet18", catalog);
const updateComps = () =>
  refreshComps(root, "TFTSet18")
    .then(async () => {
      metaComps = await loadComps(root, "TFTSet18", catalog);
      analysisCache.clear();
      console.log("Comps de meta atualizadas: " + metaComps.comps.length);
    })
    .catch((e) => console.log("Comps de meta não atualizadas: " + e.message));
if (compsAreStale(metaComps)) void updateComps();
setInterval(
  () => {
    if (compsAreStale(metaComps)) void updateComps();
  },
  30 * 60 * 1000,
).unref();
const captures = captureBoards(
  boardPath,
  path.join(root, "../data/scouting-captures.jsonl"),
);
// A análise custa ~1 s de CPU; o snapshot só muda quando o jogo regrava o arquivo.
const analysisCache = new Map();
const baseAnalysisCache = new Map();
let boardSnapshotCache = null;
async function readBoardSnapshot() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const stat = await fs.stat(boardPath);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (boardSnapshotCache?.key === key)
      return { snapshot: structuredClone(boardSnapshotCache.snapshot), stat };
    const raw = await fs.readFile(boardPath, "utf8");
    const after = await fs.stat(boardPath);
    if (after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) continue;
    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (error) {
      if (attempt === 0 && error instanceof SyntaxError) continue;
      throw error;
    }
    if (!Array.isArray(snapshot.statsBlock?.players))
      throw Error("Snapshot sem jogadores.");
    boardSnapshotCache = { key, snapshot };
    return { snapshot: structuredClone(snapshot), stat };
  }
  throw Error(
    "O jogo está atualizando o tabuleiro. Tente atualizar novamente.",
  );
}
let sticky = { game: null, id: null }; // comp de meta sugerida por último nesta partida
let localNames = {};
try {
  localNames =
    JSON.parse(await fs.readFile(path.join(root, "names-pt_br.json"), "utf8"))
      .names ?? {};
} catch {}
let augmentList = [];
try {
  augmentList =
    JSON.parse(await fs.readFile(path.join(root, "augments.json"), "utf8"))
      .augments ?? [];
} catch {}
const augmentById = new Map(augmentList.map((a) => [a.id, a]));
const screen = screenReader(
  root,
  catalog.items
    .filter((i) => icons[i.apiName] && !i.isAugment)
    .map((i) => ({ id: i.apiName, file: path.join(root, icons[i.apiName]) })),
  catalog.champions.map((c) => ({
    id: c.apiName,
    names: [c.name, localNames[c.apiName]].filter(Boolean),
  })),
  augmentList,
);
process.on("exit", () => screen.stop());
let lcuCache = { at: 0, data: null };
// Responde com o último valor e renova em segundo plano; só a primeira leitura espera o cliente do jogo.
let lcuPending = null;
function lcu() {
  if (Date.now() - lcuCache.at >= 5000 && !lcuPending)
    lcuPending = readLcu().finally(() => {
      lcuPending = null;
    });
  return lcuCache.at ? Promise.resolve(lcuCache.data) : lcuPending;
}
async function readLcu() {
  try {
    const parts = (
      await fs.readFile("C:/Riot Games/League of Legends/lockfile", "utf8")
    )
      .trim()
      .split(":");
    const get = (route) =>
      new Promise((resolve) => {
        const r = https.request(
          {
            hostname: "127.0.0.1",
            port: parts[2],
            path: route,
            rejectUnauthorized: false,
            headers: {
              Authorization:
                "Basic " + Buffer.from("riot:" + parts[3]).toString("base64"),
            },
          },
          (s) => {
            let body = "";
            s.on("data", (c) => (body += c));
            s.on("end", () => {
              try {
                resolve(JSON.parse(body));
              } catch {
                resolve(null);
              }
            });
          },
        );
        r.on("error", () => resolve(null));
        r.setTimeout(2000, () => r.destroy(Error("timeout")));
        r.end();
      });
    const [session, self, phase] = await Promise.all([
      get("/lol-gameflow/v1/session"),
      get("/lol-summoner/v1/current-summoner"),
      get("/lol-gameflow/v1/gameflow-phase"),
    ]);
    lcuCache = {
      at: Date.now(),
      data: { gameId: session?.gameData?.gameId, puuid: self?.puuid, phase },
    };
  } catch {
    lcuCache = { at: Date.now(), data: null };
  }
  return lcuCache.data;
}
function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Entrada inválida.");
  const level = Number(input.level);
  if (!Number.isInteger(level) || level < 1 || level > 11)
    throw Error("Nível deve ser de 1 a 11.");
  const gold =
    input.gold === null || input.gold === "" ? null : Number(input.gold);
  if (gold !== null && (!Number.isInteger(gold) || gold < 0 || gold > 999))
    throw Error("Ouro inválido.");
  if (!Array.isArray(input.bench) || input.bench.length > 100)
    throw Error("Banco inválido.");
  const ids = new Set(catalog.champions.map((c) => c.apiName));
  const bench = input.bench.map((u) => {
    if (
      !u ||
      !ids.has(u.championName) ||
      ![1, 2, 3].includes(u.starLevel) ||
      !Number.isInteger(u.quantity) ||
      u.quantity < 1 ||
      u.quantity > 9 ||
      !["string", "number"].includes(typeof u.playerId)
    )
      throw Error("Unidade manual inválida.");
    return {
      championName: u.championName,
      starLevel: u.starLevel,
      quantity: u.quantity,
      playerId: String(u.playerId),
      itemNames: [],
    };
  });
  const inventory = input.inventory ?? [];
  if (
    !Array.isArray(inventory) ||
    inventory.length > 60 ||
    inventory.some(
      (id) =>
        typeof id !== "string" || !catalog.items.some((i) => i.apiName === id),
    )
  )
    throw Error("Inventário de itens inválido.");
  const previewIds = input.previewIds ?? [];
  if (
    !Array.isArray(previewIds) ||
    previewIds.length > 11 ||
    new Set(previewIds).size !== previewIds.length ||
    previewIds.some((id) => typeof id !== "string" || !ids.has(id))
  )
    throw Error("Plano de campeões inválido.");
  const side = input.side ?? "right";
  if (!["left", "right"].includes(side)) throw Error("Lado inválido.");
  const targetLevel =
    input.targetLevel === undefined || input.targetLevel === "auto"
      ? "auto"
      : Number(input.targetLevel);
  if (
    targetLevel !== "auto" &&
    (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 10)
  )
    throw Error("Nível de destino inválido.");
  const goalCarryId =
    typeof input.goalCarryId === "string" ? input.goalCarryId : "";
  if (goalCarryId && !ids.has(goalCarryId))
    throw Error("Carry de destino inválido.");
  const augments = input.augments ?? [];
  if (
    !Array.isArray(augments) ||
    augments.length > 8 ||
    augments.some((id) => typeof id !== "string" || id.length > 80)
  )
    throw Error("Aprimoramentos inválidos.");
  return {
    augments,
    level,
    gold,
    bench,
    inventory,
    previewIds,
    side,
    targetLevel,
    goalCarryId,
    levelEstimated: input.levelEstimated === true,
    playerId: typeof input.playerId === "string" ? input.playerId : "",
    viewedPlayerId:
      typeof input.viewedPlayerId === "string" ? input.viewedPlayerId : "",
  };
}
async function current() {
  const [{ snapshot, stat }, session] = await Promise.all([
    readBoardSnapshot(),
    lcu(),
  ]);
  const age = Math.max(0, (Date.now() - stat.mtimeMs) / 1000);
  const sameGame = session?.gameId === snapshot.gameId;
  const local = snapshot.statsBlock.players.find(
    (p) => String(p.playerId) === HERO_ID,
  );
  return {
    snapshot,
    metadata: {
      gameId: snapshot.gameId,
      queue: snapshot.queueType,
      set: snapshot.statsBlock.setCoreName,
      modifiedAt: stat.mtime.toISOString(),
      ageSeconds: Math.round(age),
      phase: session?.phase ?? null,
      sameGame: session ? sameGame : null,
      actionable: sameGame && session.phase === "InProgress" && age < 120,
      localPlayerId: local ? String(local.playerId) : null,
      estimatedLevel: local
        ? Math.max(1, Math.min(11, local.boardPieces.length))
        : null,
      capture: captures.status(),
      players: snapshot.statsBlock.players.map((p) => ({
        id: String(p.playerId),
        name: p.riotIdGameName ?? p.summonerName,
        health: p.health,
      })),
      warnings: [
        "Banco adversário não capturado. A loja é lida da tela quando o leitor está ativo, não pelo arquivo do tabuleiro.",
        "Pool estimado: bancos ocultos, duplicadores e slots reservados em lojas não observados.",
        "Economia, posições e counters são heurísticos; comps de meta usam a cópia de estatísticas disponível. Sem simulação de combate ou garantia de vitória.",
        "Emblemas, Wisps, invocações e regras especiais de traits não são simulados.",
      ],
      catalogSource: catalog.source,
      catalogDate: catalog.fetchedAt,
    },
  };
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const json = (status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(data));
  };
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/events")
      return captures.subscribe(req, res);
    if (req.method === "GET" && url.pathname === "/api/catalog")
      return json(200, {
        champions: catalog.champions.map((c) => ({
          id: c.apiName,
          name: c.name,
          cost: c.cost,
          icon: icons[c.apiName] ?? null,
          traits: c.traits,
        })),
        items: catalog.items.map((i) => ({
          id: i.apiName,
          name: i.name,
          composition: i.composition ?? [],
          icon: icons[i.apiName] ?? null,
        })),
        traits: catalog.traits.map((t) => ({
          name: t.name,
          breakpoints: t.effects.map((e) => e.minUnits),
        })),
      });
    if (req.method === "GET" && url.pathname === "/api/state") {
      const { metadata } = await current();
      screen.sync(
        metadata.phase === "InProgress"
          ? true
          : typeof metadata.phase === "string"
            ? false
            : null,
      );
      return json(200, { ...metadata, screen: screen.status() });
    }
    if (req.method === "POST" && url.pathname === "/api/screen-capture") {
      if (
        req.headers.origin &&
        req.headers.origin !== `http://127.0.0.1:${port}` &&
        req.headers.origin !== `http://localhost:${port}`
      )
        return json(403, { error: "Origem não autorizada." });
      const file = path.join(root, "../data/screen-calibration.png");
      const shot = await screen.capture(file);
      return json(200, { ...shot, file });
    }
    if (req.method === "POST" && url.pathname === "/api/recommend") {
      if (
        req.headers.origin &&
        req.headers.origin !== `http://127.0.0.1:${port}` &&
        req.headers.origin !== `http://localhost:${port}`
      )
        return json(403, { error: "Origem não autorizada." });
      let body = "";
      for await (const part of req) {
        body += part;
        if (body.length > 64000)
          return json(413, { error: "Entrada muito grande." });
      }
      const options = validate(JSON.parse(body)),
        { snapshot, metadata } = await current();
      // Luva de Ladrão: o jogo grava os dois itens sorteados da rodada junto com ela; só a luva é um item real.
      for (const p of snapshot.statsBlock.players)
        for (const u of p.boardPieces ?? [])
          if ((u.itemNames ?? []).some((i) => /ThiefsGloves/.test(i)))
            u.itemNames = u.itemNames.filter((i) => /ThiefsGloves/.test(i));
      if (options.playerId && options.playerId !== HERO_ID)
        throw Error(
          "O jogador local é Hero. Use a consulta de adversário para ver outra arena.",
        );
      options.playerId = HERO_ID;
      if (metadata.set !== "TFTSet18")
        return json(409, {
          error: "O catálogo é do Set 18. Este snapshot pertence a outro set.",
          metadata,
        });
      const seen = screen.status();
      options.shop = (seen.shop ?? []).map((card) => card?.id ?? null);
      options.augmentIds = seen.augments ?? [];
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
        traitNameByApi = new Map(
          catalog.traits.map((t) => [t.apiName, t.name]),
        );
      options.augmentTraits = [
        ...new Set(
          chosen.flatMap((a) =>
            a.traits.map((t) => traitNameByApi.get(t)).filter(Boolean),
          ),
        ),
      ];
      options.stickyCompId = sticky.game === metadata.gameId ? sticky.id : null;
      const cacheKey =
        metadata.modifiedAt +
        "|" +
        JSON.stringify([
          metadata.actionable,
          metadata.phase,
          metadata.sameGame,
        ]) +
        "|" +
        meta.fetchedAt +
        "|" +
        metaComps.fetchedAt +
        "|" +
        JSON.stringify(options);
      const cached = analysisCache.get(cacheKey);
      if (cached) return json(200, { metadata, ...cached });
      options.metaComps = metaComps.comps;
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
      // Scouting, shop, XP and item removers affect tactics/strategy, not composition search.
      const baseKey = JSON.stringify({
        source: metadata.modifiedAt,
        builds: meta.fetchedAt,
        comps: metaComps.fetchedAt,
        level: options.level,
        targetLevel: options.targetLevel,
        gold: options.gold,
        playerId: options.playerId,
        bench: options.bench,
        inventory: options.inventory,
        previewIds: options.previewIds,
        augmentTraits: options.augmentTraits,
        stickyCompId: options.stickyCompId,
      });
      let base = baseAnalysisCache.get(baseKey);
      if (!base) {
        base = analyze(snapshot, catalog, options);
        if (baseAnalysisCache.size >= 12)
          baseAnalysisCache.delete(baseAnalysisCache.keys().next().value);
        baseAnalysisCache.set(baseKey, structuredClone(base));
      } else base = structuredClone(base);
      if (base.previewGrow.length)
        options.previewIds = [
          ...options.previewIds,
          ...base.previewGrow.map((g) => g.id),
        ];
      const analysis = tactics(base, catalog, options);
      analysis.goalIds = base.previewGrow.length ? options.previewIds : null;
      for (const plan of [
        ...analysis.recommendations,
        ...(analysis.preview ? [analysis.preview] : []),
      ]) {
        plan.playbook = playbook(plan, analysis, options, metadata);
        plan.stage = stagePlan(plan, analysis, catalog, options);
        plan.strategy = strategy(plan, analysis, options);
        if (plan.playbook && metadata.actionable && analysis.self.health > 0)
          Object.assign(plan.playbook, {
            headline: plan.strategy.headline,
            style: plan.strategy.style || plan.playbook.style,
            actions: [...plan.strategy.steps, ...plan.strategy.reasons],
            note: "Regras de economia aplicadas a estágio, nível, XP, ouro, HP, pool e loja lidos. Não simula combate nem streak.",
          });
        plan.teamCode = teamCode(
          plan.board.map((u) => u.id),
          plannerCatalog,
        );
      }
      analysis.currentLevel = options.level;
      if (analysis.self.health > 0 && analysis.recommendations[0]?.meta)
        sticky = {
          game: metadata.gameId,
          id: analysis.recommendations[0].meta.id,
        };
      analysis.chosenAugments = chosen.map((a) => ({
        id: a.id,
        name: a.name,
        traits: a.traits.map((t) => traitNameByApi.get(t)).filter(Boolean),
      }));
      analysis.augmentAdvice = augmentAdvice(
        options.augmentIds.map((id) => augmentById.get(id)).filter(Boolean),
        analysis.preview ?? analysis.recommendations[0],
        analysis,
        catalog,
        options,
        localNames,
      );
      analysis.decision = decide(analysis, options);
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
              const c = catalog.champions.find(
                (c) => c.apiName === u.championName,
              );
              return {
                ...u,
                name: c?.name ?? u.championName,
                traits: c?.traits ?? [],
              };
            }),
          }
        : null;
      if (analysisCache.size >= 12)
        analysisCache.delete(analysisCache.keys().next().value);
      analysisCache.set(cacheKey, { ...analysis, viewedBoard });
      return json(200, { metadata, ...analysis, viewedBoard });
    }
    if (
      req.method === "GET" &&
      new RegExp("^/assets/[a-f0-9]{24}[.]png$").test(url.pathname)
    ) {
      try {
        const asset = await fs.readFile(path.join(root, url.pathname.slice(1)));
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "public,max-age=86400",
        });
        return res.end(asset);
      } catch {
        return json(404, { error: "Ícone não encontrado." });
      }
    }
    const files = {
      "/": "index.html",
      "/app.js": "app.js",
      "/style.css": "style.css",
      "/planner.js": "planner.js",
      "/app-shell.css": "app-shell.css",
      "/live-view.css": "live-view.css",
      "/live-view.js": "live-view.js",
      "/strategy-view.js": "strategy-view.js",
      "/live-mock.js": "live-mock.js",
      "/live-mock.html": "live-mock.html",
      "/live-mock-base.json": "live-mock-base.json",
    };
    if (req.method === "GET" && files[url.pathname]) {
      res.writeHead(200, {
        "Content-Type": url.pathname.endsWith(".js")
          ? "text/javascript"
          : url.pathname.endsWith(".css")
            ? "text/css"
            : url.pathname.endsWith(".json")
              ? "application/json"
              : "text/html; charset=utf-8",
      });
      return res.end(await fs.readFile(path.join(root, files[url.pathname])));
    }
    json(404, { error: "Rota não encontrada." });
  } catch (e) {
    json(400, { error: e.message });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`TFT Helper: http://127.0.0.1:${port}`),
);
server.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
