import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./engine.mjs";
import { emblemTraitMap, traitsWithEmblems } from "./v2/js/traits.js";
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
import {
  KINDS as ITEM_KINDS,
  isConsumable,
  itemTiers,
  kindOf,
} from "./item-tiers.mjs";
import { loadComps, refreshComps, compsAreStale } from "./meta-comps.mjs";
import { screenReader } from "./screen-reader.mjs";
import { gameLog, mergeSources } from "./game-log.mjs";
import { levelTracker } from "./level.mjs";
import { gepBenchUnits, gepReader, mergeGep } from "./gep-reader.mjs";
import { benchCandidates as buildBenchCandidates } from "./bench-candidates.mjs";
import { installDiagnostics } from "./diagnostics.mjs";
import { streakTracker } from "./streak.mjs";
import { contestAlert } from "./contest.mjs";
import { gameRows, replaySnapshot } from "./replay.mjs";
import { hiddenHoldings } from "./pool-tracker.mjs";
import { explorer } from "./evidence.mjs";
import { loadStats, refreshStats, statsAreStale } from "./meta-stats.mjs";
import {
  augmentStatsAreStale,
  loadAugmentStats,
  refreshAugmentStats,
} from "./augment-stats.mjs";
import { matchTracker } from "./match.mjs";
import { planTracker } from "./plan-state.mjs";
import {
  baseId as baseIdOf,
  baseInputs as baseInputsOf,
  snapshotSignature,
} from "./analysis-keys.mjs";
import { lobbyRecorder } from "./lobbies.mjs";
import { recommendInventory } from "./item-holdings.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TFT_HELPER_PORT ?? 3218);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Porta inválida.");
// Log em server.log (rotaciona em 1 MB); erros não tratados são registrados sem derrubar o servidor.
const diag = installDiagnostics(
  path.join(root, "server.log"),
  path.join(root, `server.${port}.run`),
  { port },
);
// Porta antes de tudo: uma segunda instância sem a porta sai aqui, antes de criar captura, histórico, leitor de
// tela e timers (viva sem servir, ela gravava tudo em dobro). As rotas entram no fim do módulo (`handle`).
let handle = null;
const server = http.createServer((req, res) => {
  if (handle) return void handle(req, res);
  res.writeHead(503, {
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": "2",
  });
  res.end(
    JSON.stringify({
      error: "Servidor iniciando. Tente de novo em instantes.",
    }),
  );
});
server.on("error", (e) => {
  console.error(e.message);
  diag.write("ERRO", `servidor HTTP: ${e.stack ?? e.message}`);
  if (e.code === "EADDRINUSE" || e.code === "EACCES" || e.syscall === "listen")
    process.exit(1);
  process.exitCode = 1;
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
diag.markRunning();
console.log(`TFT Helper: http://127.0.0.1:${port}`);
const icons = JSON.parse(
  await fs.readFile(path.join(root, "assets-manifest.json"), "utf8"),
);
const HERO_ID = "47445859"; // Identidade confirmada pelo usuário; independente da arena consultada.
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "catalog.json"), "utf8"),
);
const itemIds = new Set(catalog.items.map((i) => i.apiName));
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
// Cópia antiga ou sem o desempenho por item (tier de itens): baixa de novo.
if (metaIsStale(meta) || !Object.keys(meta.items ?? {}).length)
  void updateMeta();
setInterval(
  () => {
    if (metaIsStale(meta)) void updateMeta();
  },
  30 * 60 * 1000,
).unref();
// Estatísticas medidas de peça × estrela × itens (trunfos) e o explorer para medir tabuleiros inteiros.
let boardStats = await loadStats(root, "TFTSet18");
const updateStats = () =>
  refreshStats(root, "TFTSet18")
    .then((file) => {
      boardStats = file;
      analysisCache.clear();
      baseAnalysisCache.clear();
      console.log("Estatísticas de tabuleiro atualizadas.");
    })
    .catch((e) =>
      console.log("Estatísticas de tabuleiro não atualizadas: " + e.message),
    );
if (statsAreStale(boardStats)) void updateStats();
setInterval(
  () => statsAreStale(boardStats) && void updateStats(),
  60 * 60 * 1000,
).unref();
// Aprimoramentos: colocação medida (NoxuTFT) e tier por comp (MetaTFT).
let augmentStats = await loadAugmentStats(root);
const updateAugmentStats = () =>
  refreshAugmentStats(root)
    .then((file) => {
      augmentStats = file;
      analysisCache.clear();
      baseAnalysisCache.clear();
      console.log(
        "Estatísticas de aprimoramento atualizadas: " +
          Object.keys(file.augments).length,
      );
    })
    .catch((e) =>
      console.log(
        "Estatísticas de aprimoramento não atualizadas: " + e.message,
      ),
    );
if (augmentStatsAreStale(augmentStats)) void updateAugmentStats();
setInterval(
  () => augmentStatsAreStale(augmentStats) && void updateAugmentStats(),
  60 * 60 * 1000,
).unref();
const evidenceClient = explorer(path.join(root, "../data/evidence-cache.json"));
// Respostas do explorer já obtidas: filtro → {avg, games, top4} (null = falhou; a análise segue sem ela).
const evidenceMap = new Map();
// Tabelas condicionais já obtidas: filtro do trunfo → {units, traits} (o que rende junto com ele).
const conditionalMap = new Map();
// Versão do conteúdo dos dois mapas (muda a cada resposta guardada ou apagada): entra na chave da base analisada.
let evidenceVersion = 0;
// Perguntas que falharam (rede) ficam como null para não repetir a cada leitura; voltam a ser tentadas em 10 min.
setInterval(
  () => {
    for (const map of [evidenceMap, conditionalMap])
      for (const [k, v] of map)
        if (v === null && map.delete(k)) evidenceVersion++;
  },
  10 * 60 * 1000,
).unref();
let metaComps = await loadComps(root, "TFTSet18", catalog);
const updateComps = () =>
  refreshComps(root, "TFTSet18")
    .then(async () => {
      metaComps = await loadComps(root, "TFTSet18", catalog);
      analysisCache.clear();
      console.log("Comps de meta atualizadas: " + metaComps.comps.length);
      // Telas abertas relêem a lista e refazem a análise sem esperar a próxima leitura.
      captures.broadcast({
        type: "meta",
        comps: metaComps.comps.length,
        fetchedAt: metaComps.fetchedAt,
      });
    })
    .catch((e) => console.log("Comps de meta não atualizadas: " + e.message));
if (compsAreStale(metaComps)) void updateComps();
setInterval(
  () => {
    if (compsAreStale(metaComps)) void updateComps();
  },
  15 * 60 * 1000,
).unref();
const captures = captureBoards(
  boardPath,
  path.join(root, "../data/scouting-captures.jsonl"),
);
// A análise custa ~1 s de CPU; o snapshot só muda quando o jogo regrava o arquivo.
const analysisCache = new Map();
const baseAnalysisCache = new Map();
// Análise base em andamento (com a busca de evidência), por entrada: POSTs iguais esperam a mesma.
const pendingBase = new Map();
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
// Plano em andamento da partida (id, peças, carry, título), o desafiante ainda não confirmado e o checklist de progresso:
// guardado em disco (sobrevive ao reinício) e apagado quando a partida acaba. Ver plan-state.mjs.
const planState = planTracker({
  file: path.join(root, "../data/plan-state.json"),
});
const planLog = path.join(root, "../data/plan-changes.jsonl");
const streaks = streakTracker(); // sequência de vitórias/derrotas inferida pelo HP entre rodadas
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
// Aprimoramento que dá o emblema de uma sinergia ("X Crest/Crown/Circlet/Emblem" ou "Recebe um Emblema de X."):
// a sinergia (apiName) e o item do emblema. No Set 18 o de emblema se chama "X Emblem" e vem sem traits.
const traitApiByName = new Map(catalog.traits.map((t) => [t.name, t.apiName]));
// Item de emblema → sinergia, derivado do catálogo (mesma regra do motor e da interface).
const emblemTraits = emblemTraitMap(catalog.items, traitApiByName.keys());
function augmentEmblem(a) {
  if (!a.id.startsWith('DA_')) return null; // aprimoramentos de sets antigos têm nomes de sinergia que não são os do 18
  const named = /^(.+) (?:Crest|Crown|Circlet|Emblem)$/.exec(
      a.nameEn ?? "",
    )?.[1],
    given = /Recebe um Emblema de (.+?)[.,]/.exec(a.desc ?? "")?.[1],
    trait =
      traitApiByName.get(named) ??
      traitApiByName.get(given) ??
      (given && a.traits.length === 1 ? a.traits[0] : null),
    name = catalog.traits.find((t) => t.apiName === trait)?.name,
    // Há outro item de mesmo nome com o id do próprio aprimoramento (…Augment): o emblema é o outro.
    item = name
      ? catalog.items.find(
          (i) =>
            i.name === `${name} Emblem` &&
            i.apiName.startsWith('DA_') &&
            !i.apiName.endsWith('Augment'),
        )?.apiName
      : null;
  return trait ? { trait, item: item ?? null } : null;
}
// Itens do set (nomes pt-BR, receita, atributos e descrição) gerados por build-items.mjs.
let itemCatalog = [];
try {
  itemCatalog =
    JSON.parse(await fs.readFile(path.join(root, "items.json"), "utf8"))
      .items ?? [];
} catch {}
/** Tier de itens: catálogo + desempenho da cópia de meta, com o tier calculado por categoria. */
function itemsPayload() {
  const stats = meta.items ?? {},
    listed = itemCatalog.filter((i) => i.kind !== "other" || stats[i.id]);
  return {
    source: meta.label,
    fetchedAt: meta.fetchedAt,
    games: meta.games,
    kinds: ITEM_KINDS,
    items: itemTiers(listed, stats).map((i) => ({
      ...i,
      icon: icons[i.id] ?? null,
    })),
  };
}
// Ícones que o leitor compara com cada espaço do banco de itens (ver bench-candidates.mjs).
const benchCandidates = buildBenchCandidates(catalog, icons, root);
const screen = screenReader(
  root,
  benchCandidates,
  catalog.champions.map((c) => ({
    id: c.apiName,
    names: [c.name, localNames[c.apiName]].filter(Boolean),
  })),
  augmentList,
);
process.on("exit", () => screen.stop());
// Rodada e fase lidas dos arquivos que o próprio jogo grava (sem OCR); a tela segue como reserva. Ver FONTES-DE-DADOS.md.
const gameFiles = gameLog();
/** Leitura da tela com a rodada/fase do arquivo do jogo por cima e a origem de cada campo em `sources`. */
const levels = levelTracker();
/** Nível lido validado pelo estágio-rodada do arquivo do jogo, com piso derivado se faltar (ver level.mjs). */
// Fonte GEP (banco do TFTAcademy, somente leitura): vence a tela por campo quando fresca; obsoleta/ausente cai para a tela.
const gep = gepReader({
  champions: new Set(catalog.champions.map((c) => c.apiName)),
  items: new Set(catalog.items.map((i) => i.apiName)),
});
/** Partida em andamento para a fonte GEP: id, fase do cliente, set e o jogador local do tabuleiro. */
const gepContext = (metadata, snapshot) => {
  const hero = snapshot?.statsBlock?.players?.find(
    (p) => String(p.playerId) === HERO_ID,
  );
  return {
    gameId: metadata.gameId,
    inMatch:
      metadata.phase === "InProgress" || metadata.phase === "Reconnect"
        ? true
        : typeof metadata.phase === "string"
          ? false
          : null,
    set: Number(/\d+/.exec(metadata.set ?? "")?.[0]) || null,
    local: hero
      ? {
          name: hero.riotIdGameName ?? hero.summonerName,
          tag: hero.riotIdTagLine,
        }
      : null,
  };
};
const seenState = (gameId, gepCtx = null) =>
  mergeGep(
    levels.apply(
      mergeSources(screen.status(), gameFiles.status(gameId)),
      gameId,
    ),
    gepCtx ? gep.status(gepCtx) : null,
  );
// Início e fim de partida: zera o que pertence à partida anterior e avisa as telas pelo SSE.
// Tabuleiros finais dos 8 jogadores com a colocação oficial (validação do modelo de tabuleiro).
const lobbies = lobbyRecorder(path.join(root, "../data/lobby-boards.jsonl"));
const matches = matchTracker(
  path.join(root, "../data/match-history.jsonl"),
  HERO_ID,
  {
    onChange({ kind, record }) {
      // Só partida nova zera; "resume" (encerrada por engano e reaberta) mantém plano, caches e leitor.
      if (kind === "start") {
        analysisCache.clear();
        baseAnalysisCache.clear();
        // O plano não é zerado aqui: o estado é da partida (gameId) e "start" também dispara quando o servidor reinicia
        // no meio de uma partida, que deve continuar com o plano guardado em disco.
        screen.stop();
      }
      // Partida registrada no histórico: o plano e o progresso dela não valem para a próxima. "end" não zera: uma
      // partida encerrada por engano pode reabrir ("resume") e continua com o mesmo plano.
      if (kind === "saved") planState.reset();
      const match = matches.status();
      diag.write(
        "INFO",
        kind === "saved"
          ? `partida ${record.gameId} registrada: ${record.placement ?? "?"}º`
          : `partida ${match.id} ${kind === "start" ? "iniciada" : kind === "resume" ? "reaberta" : "encerrada"}`,
      );
      captures.broadcast({ type: "match", kind, match });
    },
  },
);
// Acompanha a partida mesmo sem nenhuma tela aberta, para o histórico não depender da interface.
let watchingMatch = false;
async function watchMatch() {
  if (watchingMatch) return;
  watchingMatch = true;
  try {
    const [board, session] = await Promise.all([
      readBoardSnapshot().catch(() => null),
      lcu(),
    ]);
    matches.observe(board?.snapshot ?? null, board?.stat ?? null, session);
    if (board?.snapshot) lobbies.observe(board.snapshot);
  } catch (e) {
    diag.write("AVISO", `acompanhamento da partida: ${e.stack ?? e.message}`);
  } finally {
    watchingMatch = false;
  }
}
setInterval(() => void watchMatch(), 2000).unref();
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
    // `at` em data identifica a leitura: o rastreador conta leituras do cliente, não chamadas.
    const at = Date.now();
    lcuCache = {
      at,
      data: {
        gameId: session?.gameData?.gameId,
        puuid: self?.puuid,
        phase,
        at,
      },
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
  // Sem banco informado: o jogo não expõe o banco de ninguém e a entrada manual foi removida (FONTES-DE-DADOS.md).
  const bench = [];
  const ids = new Set(catalog.champions.map((c) => c.apiName));
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
  // A tela tem registro de aprimoramentos desta partida: a lista vale mesmo vazia (remoção explícita).
  if (
    input.augmentsKnown !== undefined &&
    typeof input.augmentsKnown !== "boolean"
  )
    throw Error("Aprimoramentos inválidos.");
  const goalCompId = input.goalCompId ?? "";
  if (typeof goalCompId !== "string" || !/^[\w-]{0,40}$/.test(goalCompId))
    throw Error("Comp escolhida inválida.");
  // Substituições aplicadas sobre a comp escolhida: pares {out, in} de campeões do catálogo.
  const goalSwaps = input.goalSwaps ?? [];
  if (
    !Array.isArray(goalSwaps) ||
    goalSwaps.length > 10 ||
    goalSwaps.some(
      (s) => !s || !ids.has(s.out) || !ids.has(s.in) || s.out === s.in,
    )
  )
    throw Error("Substituições inválidas.");
  // Substituições no automático: {idDaComp: [{out, in}]}, aplicadas à comp de meta quando ela é sugerida.
  const compSwaps = input.compSwaps ?? {};
  if (
    !compSwaps ||
    typeof compSwaps !== "object" ||
    Array.isArray(compSwaps) ||
    Object.keys(compSwaps).length > 10 ||
    Object.entries(compSwaps).some(
      ([id, list]) =>
        !/^[\w-]{1,40}$/.test(id) ||
        !Array.isArray(list) ||
        list.length > 10 ||
        list.some(
          (x) => !x || !ids.has(x.out) || !ids.has(x.in) || x.out === x.in,
        ),
    )
  )
    throw Error("Substituições inválidas.");
  // Rever partida passada: id numérico de uma partida capturada.
  const replayGameId = input.replayGameId ?? "";
  if (typeof replayGameId !== "string" || !/^\d{0,20}$/.test(replayGameId))
    throw Error("Partida a rever inválida.");
  return {
    compSwaps: Object.fromEntries(
      Object.entries(compSwaps).map(([id, list]) => [
        id,
        list.map((x) => ({ out: x.out, in: x.in })),
      ]),
    ),
    replayGameId,
    goalCompId,
    goalSwaps: goalSwaps.map((s) => ({ out: s.out, in: s.in })),
    augments,
    augmentsKnown: input.augmentsKnown === true,
    level,
    gold,
    bench,
    inventory,
    previewIds,
    side,
    targetLevel,
    goalCarryId,
    levelEstimated: input.levelEstimated === true,
    levelSource: ["tela", "derivado", "estimado"].includes(input.levelSource)
      ? input.levelSource
      : input.levelEstimated === true
        ? "estimado"
        : "tela",
    playerId: typeof input.playerId === "string" ? input.playerId : "",
    viewedPlayerId:
      typeof input.viewedPlayerId === "string" ? input.viewedPlayerId : "",
  };
}
/** Estado final de uma partida passada, reconstruído das capturas de tabuleiro (ver replay.mjs). */
async function replayState(gameId) {
  const record =
      matches.history().find((r) => String(r.gameId) === gameId) ?? null,
    found = await replaySnapshot(
      path.join(root, "../data/scouting-captures.jsonl"),
      gameId,
      { heroId: HERO_ID, set: "TFTSet18", record },
    );
  if (!found)
    throw Error("Esta partida não tem tabuleiros capturados para rever.");
  const { snapshot, endedAt } = found,
    local = snapshot.statsBlock.players.find(
      (p) => String(p.playerId) === HERO_ID,
    );
  if (!local) throw Error("O Hero não aparece nas capturas desta partida.");
  return {
    snapshot,
    metadata: {
      gameId: snapshot.gameId,
      queue: snapshot.queueType,
      set: snapshot.statsBlock.setCoreName,
      modifiedAt: endedAt,
      ageSeconds: Math.round((Date.now() - Date.parse(endedAt)) / 1000),
      phase: "Replay",
      sameGame: null,
      actionable: false,
      replay: true,
      localPlayerId: HERO_ID,
      estimatedLevel: Math.max(1, Math.min(11, local.boardPieces.length)),
      match: {
        id: snapshot.gameId,
        status: "replay",
        placement: record?.placement ?? null,
        last: record,
      },
      players: snapshot.statsBlock.players.map((p) => ({
        id: String(p.playerId),
        name: p.riotIdGameName,
        health: p.health,
      })),
      warnings: [
        "Partida passada: tabuleiros finais capturados; banco, loja, ouro e XP não foram registrados.",
      ],
    },
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
  const match = matches.observe(snapshot, stat, session);
  return {
    snapshot,
    metadata: {
      gameId: snapshot.gameId,
      queue: snapshot.queueType,
      set: snapshot.statsBlock.setCoreName,
      modifiedAt: stat.mtime.toISOString(),
      // Conteúdo do snapshot: a tela só pede análise nova quando ele muda, não a cada regravação do arquivo.
      signature: snapshotSignature(snapshot),
      ageSeconds: Math.round(age),
      phase: session?.phase ?? null,
      sameGame: session ? sameGame : null,
      actionable: sameGame && session.phase === "InProgress" && age < 120,
      localPlayerId: local ? String(local.playerId) : null,
      // Peças em campo: ESTIMATIVA de último recurso, não leitura (jogar abaixo do nível, slot extra e invocações a
      // invalidam). Só entra na análise com levelEstimated = true; o nível lido/derivado vem de screen.level.
      estimatedLevel: local
        ? Math.max(1, Math.min(11, local.boardPieces.length))
        : null,
      capture: captures.status(),
      match,
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
handle = async (req, res) => {
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
          // Tipo (completed, component, radiant, artifact, emblem, other) e se é consumível: a aba Comps relaciona o banco ao carry por eles.
          kind: kindOf(i.apiName, i.composition ?? []),
          consumable: isConsumable(i.apiName),
          // Sinergia que o item dá a quem o equipa (emblemas); a interface soma com a regra de traits.js.
          trait: emblemTraits.get(i.apiName) ?? null,
        })),
        traits: catalog.traits.map((t) => ({
          name: t.name,
          breakpoints: t.effects.map((e) => e.minUnits),
          icon: icons["trait:" + t.apiName] ?? null,
        })),
      });
    if (req.method === "GET" && url.pathname === "/api/comps")
      return json(200, {
        source: metaComps.label,
        fetchedAt: metaComps.fetchedAt,
        comps: metaComps.comps.map((c) => ({
          id: c.id,
          title: c.title,
          tier: c.tier,
          units: c.units,
          carry: c.carry,
          key: c.key,
          levelling: c.levelling,
          rerollLevel: c.rerollLevel,
          stars3: c.stars3,
          builds: c.builds,
          buildStats: c.buildStats ?? {},
          games: c.games,
          avg: c.avg,
          top4: c.top4,
          win: c.win,
        })),
      });
    if (req.method === "GET" && url.pathname === "/api/history")
      return json(200, { matches: matches.history() });
    if (req.method === "GET" && url.pathname === "/api/items")
      return json(200, itemsPayload());
    if (req.method === "GET" && url.pathname === "/api/state") {
      const { metadata, snapshot } = await current();
      screen.sync(
        // Reconnect é partida em andamento (o rastreador de partidas também a conta): parar o leitor ali apagaria nível e ouro.
        metadata.phase === "InProgress" || metadata.phase === "Reconnect"
          ? true
          : typeof metadata.phase === "string"
            ? false
            : null,
      );
      const { gepStatus, ...seenNow } = seenState(
        metadata.gameId,
        gepContext(metadata, snapshot),
      );
      streaks.observe({
        gameId: metadata.gameId,
        stage: seenNow.stage,
        hp: metadata.players.find((p) => p.id === HERO_ID)?.health,
      });
      return json(200, {
        ...metadata,
        screen: seenNow,
        // Fonte GEP (banco do TFTAcademy): ativo, obsoleto, ausente ou esquema-desconhecido, com o motivo e a idade do último evento.
        gepStatus,
        // Origem e estado bruto dos arquivos do jogo; `hints` são estimativas (voz de compra etc.), não dado observado.
        gameFiles: gameFiles.status(metadata.gameId),
        // Compras e fusões do TFT.log contra o tabuleiro: a reserva NÃO é reconstruível (o log não grava venda nem
        // movimento); `bench.upperBound` é só um teto. A reserva observada vem do GEP (`screen.sources.bench`); sem ele, fica sem fonte. Ver FONTES-DE-DADOS.md.
        unitLedger: gameFiles.ledger(
          metadata.gameId,
          snapshot.statsBlock.players.find(
            (p) => String(p.playerId) === HERO_ID,
          )?.boardPieces ?? [],
        ),
        streak: streaks.current(),
      });
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
        { snapshot, metadata } = options.replayGameId
          ? await replayState(options.replayGameId)
          : await current();
      if (options.replayGameId) options.level = metadata.estimatedLevel;
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
      // Comp de meta fixada na tela de seleção: unidades, carry e builds vêm da cópia local pela id.
      const goal = options.goalCompId
        ? (metaComps.comps.find((c) => c.id === options.goalCompId) ?? null)
        : null;
      if (goal) {
        // Cada troca só vale se a peça que sai está na comp e a que entra ainda não está.
        const units = goal.units.filter(
          (id) =>
            !catalog.champions
              .find((c) => c.apiName === id)
              ?.traits.includes("Avatar"),
        );
        options.goalSwaps = options.goalSwaps.filter(
          (s) =>
            s.out !== goal.carry &&
            units.includes(s.out) &&
            !units.includes(s.in),
        );
        for (const s of options.goalSwaps)
          units.splice(units.indexOf(s.out), 1, s.in);
        options.previewIds = units;
        options.goalCarryId = options.previewIds.includes(goal.carry)
          ? goal.carry
          : "";
      }
      if (metadata.set !== "TFTSet18")
        return json(409, {
          error: "O catálogo é do Set 18. Este snapshot pertence a outro set.",
          metadata,
        });
      // Partida revista: a leitura de tela é da partida de agora e não vale para ela.
      const seen = options.replayGameId
        ? {}
        : seenState(metadata.gameId, gepContext(metadata, snapshot));
      // Reserva: só com origem GEP fresca (a entrada manual saiu e o cliente não a define). Sem GEP fica vazia.
      options.bench = gepBenchUnits(seen, HERO_ID);
      // Banco de itens: a leitura de tela de agora (sem consumíveis) manda; o enviado pelo cliente só vale sem leitura.
      options.inventory = recommendInventory(options.inventory, seen, (id) =>
        itemIds.has(id),
      );
      // Banco lido da tela (ou enviado pelo cliente): sem ele o plano de itens não atribui nada, só lista desejos.
      options.bankRead =
        !options.replayGameId &&
        (Array.isArray(seen.items) || options.inventory.length > 0);
      options.shop = (seen.shop ?? []).map((card) => card?.id ?? null);
      // Oferta lida da tela; some quando uma das cartas já foi marcada como escolhida.
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
      // Partida revista: os aprimoramentos gravados no registro dela, se a tela não mandou outros.
      if (options.replayGameId && !options.augments.length)
        options.augments = (metadata.match?.last?.augments ?? [])
          .map((a) => a.id)
          .filter((id) => augmentById.has(id));
      const chosen = options.augments
          .map((id) => augmentById.get(id))
          .filter(Boolean),
        traitNameByApi = new Map(
          catalog.traits.map((t) => [t.apiName, t.name]),
        );
      // Lista vazia só apaga o registro da partida quando a tela diz que tem um (remoção explícita).
      if (!options.replayGameId && (chosen.length || options.augmentsKnown))
        matches.augments(metadata.gameId, chosen);
      // Sinergias (apiName) de cada aprimoramento escolhido, com a do emblema que ele dá.
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
      // O motor não soma o tier de quem já foi medido pela sinergia.
      options.augmentTraitsById = Object.fromEntries(
        chosen.map((a) => [a.id, traitsOfAug(a)]),
      );
      // Nomes para a linha de evidência mostrar o ajuste de cada aprimoramento.
      options.augmentNames = Object.fromEntries(
        chosen.map((a) => [a.id, a.name]),
      );
      options.sticky = options.replayGameId
        ? null
        : planState.sticky(metadata.gameId);
      options.stickyCompId = options.sticky?.id ?? null;
      // Plano em andamento: um desafiante só o substitui depois de liderar por mais de uma rodada (plan-state.mjs).
      options.holdPlan =
        !options.replayGameId && planState.holdFor(metadata.gameId);
      if (!options.replayGameId)
        streaks.observe({
          gameId: metadata.gameId,
          stage: seen.stage,
          hp: snapshot.statsBlock.players.find(
            (p) => String(p.playerId) === HERO_ID,
          )?.health,
        });
      options.streak = options.replayGameId ? null : streaks.current();
      options.trend = options.replayGameId ? null : streaks.trend();
      // Banco dos rivais estimado pelas peças que saíram do tabuleiro deles (ver pool-tracker.mjs). Meio
      // em meio para a chave de cache não mudar a cada segundo de decaimento. Só rivais vivos no snapshot
      // atual contam: a captura só grava quando o tabuleiro muda, e um eliminado pode sumir da lista.
      const alive = new Set(
        snapshot.statsBlock.players
          .filter((p) => (p.health ?? 1) > 0)
          .map((p) => String(p.playerId)),
      );
      options.hidden = Object.fromEntries(
        [
          ...hiddenHoldings(
            (
              await gameRows(
                path.join(root, "../data/scouting-captures.jsonl"),
                metadata.gameId,
              )
            ).filter((r) => alive.has(String(r.id))),
            {
              now: options.replayGameId
                ? Date.parse(metadata.modifiedAt)
                : Date.now(),
              skip: new Set([HERO_ID]),
            },
          ),
        ]
          .map(([id, n]) => [id, Math.round(n * 2) / 2])
          .filter(([, n]) => n > 0),
      );
      // Conteúdo do snapshot, não o horário em que o jogo regravou o arquivo (ver analysis-keys.mjs).
      const signature = snapshotSignature(snapshot);
      const cacheKey =
        signature +
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
      // Automático com substituições: a comp de meta já entra no ranking com as peças trocadas pelo usuário.
      options.metaComps = metaComps.comps.map((c) => {
        const list = (options.compSwaps[c.id] ?? []).filter(
          (x) =>
            x.out !== c.carry &&
            c.units.includes(x.out) &&
            !c.units.includes(x.in),
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
      // Aprimoramento que dá emblema (Insígnia/Coroa/Tiara/Emblema de X): o emblema de X entra como item seu.
      options.augmentEmblems = chosen
        .map((a) => emblemOf.get(a.id)?.item)
        .filter(Boolean);
      // O motor escolhe os trunfos e diz o que precisa saber da MetaTFT; o servidor busca e refaz a análise.
      options.conditional = conditionalMap;
      options.evidence = evidenceMap;
      // Scouting, shop, XP and item removers affect tactics/strategy, not composition search.
      // Tudo o que analyze lê de options (sem a evidência, versionada à parte em baseKey()).
      const baseInputs = baseInputsOf(options, {
        source: signature,
        builds: meta.fetchedAt,
        comps: metaComps.fetchedAt,
        stats: boardStats?.fetchedAt ?? null,
      });
      const baseKey = () => `${evidenceVersion}|${baseInputs}`;
      let built = baseAnalysisCache.get(baseKey());
      if (!built) {
        let pending = pendingBase.get(baseInputs);
        if (!pending) {
          pending = (async () => {
            let fresh = analyze(snapshot, catalog, options);
            // Perguntas novas ao explorer (tabelas dos trunfos, depois os totais dos tabuleiros): busca em paralelo e
            // refaz a análise com as respostas. Três rodadas bastam: trunfos → candidatos → medição.
            for (
              let pass = 0;
              pass < 3 &&
              (fresh.conditionalRequests.length ||
                fresh.evidenceRequests.length);
              pass++
            ) {
              await Promise.all([
                ...fresh.conditionalRequests.map((f) =>
                  evidenceClient
                    .conditional(f)
                    .then((c) => conditionalMap.set(f, c))
                    .catch(() => conditionalMap.set(f, null))
                    .finally(() => evidenceVersion++),
                ),
                evidenceClient.totals(fresh.evidenceRequests).then((got) => {
                  for (const [k, val] of got) evidenceMap.set(k, val);
                  if (got.size) evidenceVersion++;
                }),
              ]);
              fresh = analyze(snapshot, catalog, options);
            }
            // Guarda com a versão de agora (a que esta análise viu), sem await entre analyze e a chave. Com perguntas
            // ainda abertas (parou no 3º passe) não guarda: a próxima leitura busca o resto e refaz.
            if (
              !fresh.conditionalRequests.length &&
              !fresh.evidenceRequests.length
            ) {
              if (baseAnalysisCache.size >= 12)
                baseAnalysisCache.delete(baseAnalysisCache.keys().next().value);
              baseAnalysisCache.set(baseKey(), fresh);
            }
            return fresh;
          })().finally(() => pendingBase.delete(baseInputs));
          pendingBase.set(baseInputs, pending);
        }
        built = await pending;
      }
      // A base guardada/compartilhada nunca é alterada: cada resposta trabalha numa cópia.
      const base = structuredClone(built);
      if (base.previewGrow.length)
        options.previewIds = [
          ...options.previewIds,
          ...base.previewGrow.map((g) => g.id),
        ];
      options.goalComp = goal;
      const analysis = tactics(base, catalog, options);
      analysis.goalIds = base.previewGrow.length ? options.previewIds : null;
      // A comp fixada vira um plano de meta como as sugestões: mesmo título e dados que a economia usa.
      analysis.goal = options.goalCompId
        ? { id: options.goalCompId, found: !!goal, swaps: options.goalSwaps }
        : null;
      // Substituições valendo na comp sugerida (automático).
      const shownId = analysis.recommendations[0]?.meta?.id;
      analysis.autoSwaps = goal
        ? []
        : (options.metaComps.find((c) => c.id === shownId)?.appliedSwaps ?? []);
      if (analysis.preview) analysis.preview.flex = base.previewFlex ?? [];
      // Emblema e evidência da comp fixada vêm da linha dela no ranking (medidos na comp de meta, sem as trocas
      // nem as peças acrescentadas: aproximação para exibir).
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
        plan.playbook = playbook(plan, analysis, options, metadata);
        plan.stage = stagePlan(plan, analysis, catalog, options);
        plan.strategy = strategy(plan, analysis, options);
        if (plan.playbook && metadata.actionable && analysis.self.health > 0)
          Object.assign(plan.playbook, {
            headline: plan.strategy.headline,
            style: plan.strategy.style || plan.playbook.style,
            actions: [...plan.strategy.steps, ...plan.strategy.reasons],
            note: "Regras de economia aplicadas a estágio, nível, XP, ouro, HP, pool e loja lidos; sequência inferida pelo HP entre rodadas. Não simula combate.",
          });
        plan.teamCode = teamCode(
          plan.board.map((u) => u.id),
          plannerCatalog,
        );
      }
      analysis.currentLevel = options.level;
      if (
        !options.replayGameId &&
        analysis.self.health > 0 &&
        (analysis.recommendations[0]?.meta ||
          analysis.recommendations[0]?.freeId)
      ) {
        const top = analysis.recommendations[0];
        // Livro-razão do TFT.log (compras): só o teto da reserva das peças do plano que ainda não estão em campo.
        let ledger = null;
        try {
          ledger = gameFiles.ledger(
            metadata.gameId,
            snapshot.statsBlock.players.find(
              (p) => String(p.playerId) === HERO_ID,
            )?.boardPieces ?? [],
          );
        } catch {}
        // Plano em andamento: adota/mantém/troca (com confirmação) e atualiza o checklist de progresso.
        const { switched, progress } = planState.track({
          gameId: metadata.gameId,
          stage: seen.stage ?? null,
          level: options.level,
          targetLevel: options.targetLevel,
          gold: options.gold,
          top,
          shown: analysis.preview ?? top,
          analysis,
          chosen: chosen.map((a) => ({ id: a.id, name: a.name })),
          ledger,
          baseId: baseIdOf(baseInputs),
          pinned: !!analysis.preview,
        });
        analysis.planProgress = progress;
        // Troca de plano na mesma partida: registra quando, de qual para qual e com que margem (revisão depois).
        if (switched)
          fs.appendFile(
            planLog,
            JSON.stringify({
              gameId: metadata.gameId,
              at: new Date().toISOString(),
              stage: options.stage
                ? `${options.stage.stage}-${options.stage.round}`
                : null,
              level: options.level,
              hp: analysis.self.health,
              from: switched.from,
              to: switched.to,
              expected: top.evidence?.expected ?? null,
              switch: top.evidence?.switch ?? null,
            }) + "\n",
          ).catch(() => {});
      }
      analysis.chosenAugments = chosen.map((a) => ({
        id: a.id,
        name: a.name,
        desc: a.desc,
        traits: a.traits.map((t) => traitNameByApi.get(t)).filter(Boolean),
      }));
      // A ordem das ofertas considera o caminho já escolhido (sinergias dos aprimoramentos anteriores).
      options.chosenAugments = chosen;
      analysis.augmentAdvice = augmentAdvice(
        options.augmentIds.map((id) => augmentById.get(id)).filter(Boolean),
        analysis.preview ?? analysis.recommendations[0],
        analysis,
        catalog,
        options,
        localNames,
      );
      analysis.decision = decide(analysis, options);
      // Lobby jogando as mesmas peças da comp exibida: quem disputa e uma comp menos disputada para trocar.
      analysis.contest = contestAlert({
        plan: analysis.preview ?? analysis.recommendations[0],
        opponents: analysis.opponents,
        ranking: analysis.compRanking ?? [],
        comps: metaComps.comps,
        mine: analysis.self.units.map((u) => u.championName),
        stage: options.stage,
      });
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
    if (
      req.method === "GET" &&
      ["/v2", "/v2/", "/v2/index.html"].includes(url.pathname)
    ) {
      // Endereço antigo da interface, que agora é a principal.
      res.writeHead(301, { Location: "/" + url.search + url.hash });
      return res.end();
    }
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname.startsWith("/v2/"))
    ) {
      // Interface: arquivos estáticos de ./v2, apenas tipos web e sem sair do diretório.
      const base = path.resolve(root, "v2"),
        target = path.resolve(
          base,
          url.pathname === "/" ? "index.html" : url.pathname.slice(4),
        ),
        types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        },
        type = types[path.extname(target)];
      if (!type || !target.startsWith(base + path.sep))
        return json(404, { error: "Rota não encontrada." });
      try {
        res.writeHead(200, {
          "Content-Type": type,
          "Cache-Control": "no-cache",
        });
        return res.end(await fs.readFile(target));
      } catch {
        return json(404, { error: "Arquivo não encontrado." });
      }
    }
    const files = {
      // Módulos puros de economia: o mock da interface usa as mesmas contas do servidor.
      "/economy.mjs": "economy.mjs",
      "/rules.mjs": "rules.mjs",
      "/live-mock.js": "live-mock.js",
      "/live-mock.html": "live-mock.html",
      "/live-mock-base.json": "live-mock-base.json",
    };
    if (req.method === "GET" && files[url.pathname]) {
      res.writeHead(200, {
        "Content-Type": /[.]m?js$/.test(url.pathname)
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
    diag.write(
      "AVISO",
      `${req.method} ${req.url} → 400: ${e.stack ?? e.message}`,
    );
    json(400, { error: e.message });
  }
};
