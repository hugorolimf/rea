import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { traitBook } from "./core/catalog/traits.mjs";
import { sendStatic } from "./static-files.mjs";
import { captureBoards } from "./capture.mjs";
import { metaIsStale } from "./meta-builds.mjs";
import { KINDS as ITEM_KINDS, itemTiers } from "./item-tiers.mjs";
import { isConsumable, kindOf } from "./core/catalog/items.mjs";
import { compsAreStale } from "./meta-comps.mjs";
import { gameLog } from "./game-log.mjs";
import { gepReader, wispCatalog } from "./gep-reader.mjs";
import { createStateHub, gepContextFor } from "./app/state.mjs";
import { createOverlayFeed } from "./app/overlay-feed.mjs";
import { createLiveSnapshots } from "./app/live-snapshot.mjs";
import {
  practiceOf,
  practiceSignal,
  withPracticeHealth,
} from "./core/state/practice.mjs";
import {
  createSupervision,
  failRequest,
  loopLagProbe,
} from "./app/supervision.mjs";
import { threadWorker } from "./app/analysis-runner.mjs";
import { carouselFeed } from "./app/carousel-view.mjs";
import { createRecommender, stageTimer } from "./app/recommend.mjs";
import { createAutoRefresh, createRecentResults } from "./app/auto-refresh.mjs";
import { installDiagnostics } from "./diagnostics.mjs";
import { streakTracker } from "./streak.mjs";
import { replaySnapshot } from "./replay.mjs";
import { explorer } from "./evidence.mjs";
import { loadProbe, yieldToLoop } from "./app/live-load.mjs";
import { statsAreStale } from "./meta-stats.mjs";
import { augmentStatsAreStale } from "./augment-stats.mjs";
import { createMetaStore, defaultMetaDir } from "./meta-store.mjs";
import { matchTracker } from "./match.mjs";
import { planTracker } from "./plan-state.mjs";
import { snapshotSignature } from "./core/state/snapshot-identity.mjs";
import { lobbyRecorder } from "./lobbies.mjs";
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
// Laços protegidos e batimento de cada fonte para GET /api/health (app/supervision.mjs).
const { every, health: pulseHealth } = createSupervision({
  log: (level, text) => diag.write(level, text),
});
// Porta antes de tudo: uma segunda instância sem a porta sai aqui, antes de criar captura, histórico, leitor de
// tela e timers (viva sem servir, ela gravava tudo em dobro). As rotas entram no fim do módulo (`handle`).
let handle = null;
const failed = (req, res, e) =>
  failRequest(req, res, e, (level, text) => diag.write(level, text));
const server = http.createServer((req, res) => {
  try {
    if (handle)
      return void Promise.resolve(handle(req, res)).catch((e) =>
        failed(req, res, e),
      );
    res.writeHead(503, {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": "2",
    });
    res.end(
      JSON.stringify({
        error: "Servidor iniciando. Tente de novo em instantes.",
      }),
    );
  } catch (e) {
    failed(req, res, e);
  }
});
// Requisição malformada: responde 400 e fecha só aquela conexão.
server.on("clientError", (error, socket) => {
  try {
    if (socket.writable && !socket.destroyed)
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    else socket.destroy();
  } catch {}
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
// O pipeline da recomendação (app/recommend.mjs) e seus caches; criado depois do estado e das fontes, abaixo. As cópias de
// meta renovadas em segundo plano o limpam (`?.` porque a primeira renovação pode terminar antes de ele existir).
let recommender = null;
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
// Extensão MetaTFT offline (meta-store.mjs): lê a cópia mais nova que passa na validação (local, anterior ou o snapshot
// do repositório), renova em segundo plano e, sem rede, segue com o que tem. O atalho já sincroniza antes de subir o servidor.
const metaStore = createMetaStore({
  root,
  dir: defaultMetaDir(root),
  set: "TFTSet18",
});
// Falha de uma renovação vira exceção só para cair no mesmo `catch` com a mensagem de sempre.
const renewed = async (name, ctx) => {
  const r = await metaStore.refresh(name, ctx);
  if (!r.ok) throw r.error;
  return r.value;
};
let meta = (await metaStore.load("builds")).value;
const updateMeta = () =>
  renewed("builds")
    .then((m) => {
      meta = m;
      console.log("Builds de meta atualizadas: " + m.label);
    })
    .catch((e) => console.log("Builds de meta não atualizadas: " + e.message));
// Cópia antiga ou sem o desempenho por item (tier de itens): baixa de novo.
if (metaIsStale(meta) || !Object.keys(meta.items ?? {}).length)
  void updateMeta();
every("meta builds", 30 * 60 * 1000, () => {
  if (metaIsStale(meta)) void updateMeta();
});
// Estatísticas medidas de peça × estrela × itens (trunfos) e o explorer para medir tabuleiros inteiros.
let boardStats = (await metaStore.load("stats")).value;
const updateStats = () =>
  renewed("stats")
    .then((file) => {
      boardStats = file;
      recommender?.clear();
      console.log("Estatísticas de tabuleiro atualizadas.");
    })
    .catch((e) =>
      console.log("Estatísticas de tabuleiro não atualizadas: " + e.message),
    );
if (statsAreStale(boardStats)) void updateStats();
every("meta estatísticas", 60 * 60 * 1000, () => {
  if (statsAreStale(boardStats)) void updateStats();
});
// Aprimoramentos: colocação medida (NoxuTFT) e tier por comp (MetaTFT).
let augmentStats = (await metaStore.load("augments")).value;
const updateAugmentStats = () =>
  renewed("augments")
    .then((file) => {
      augmentStats = file;
      recommender?.clear();
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
every("meta aprimoramentos", 60 * 60 * 1000, () => {
  if (augmentStatsAreStale(augmentStats)) void updateAugmentStats();
});
const evidenceFile = path.join(root, "../data/evidence-cache.json");
// O explorer só é criado (e o cache de evidência lido do disco) se a análise rodar neste processo: com a thread de análise
// ela é a única dona do arquivo.
let explorerInstance = null;
const evidenceClient = new Proxy(
  {},
  {
    get: (_, name) => (explorerInstance ??= explorer(evidenceFile))[name],
  },
);
// Teto de espera de rede (explorer) por análise nova; passado ele a análise segue com o que já chegou e o resto
// entra no cache para a leitura seguinte (app/live-load.mjs). `TFT_EVIDENCE_BUDGET_MS` muda o teto; valor enorme = sem teto.
const EVIDENCE_BUDGET_MS = Number(process.env.TFT_EVIDENCE_BUDGET_MS) || 15_000;
let metaComps = (await metaStore.load("comps", { catalog })).value;
const updateComps = () =>
  renewed("comps", { catalog })
    .then((value) => {
      metaComps = value;
      recommender?.clear({ base: false });
      console.log("Comps de meta atualizadas: " + metaComps.comps.length);
      // Telas abertas relêem a lista e refazem a análise sem esperar a próxima leitura.
      captures.broadcast({
        type: "meta",
        comps: metaComps.comps.length,
        fetchedAt: metaComps.fetchedAt,
        freshness: metaStore.freshness("comps"),
      });
    })
    .catch((e) => console.log("Comps de meta não atualizadas: " + e.message));
if (compsAreStale(metaComps)) void updateComps();
every("meta comps", 15 * 60 * 1000, () => {
  if (compsAreStale(metaComps)) void updateComps();
});
const captures = captureBoards(
  boardPath,
  path.join(root, "../data/scouting-captures.jsonl"),
);
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
// Wisps (fogos-fátuos) do Set 18, gerados por build-wisps.mjs; a interface os reconhece na loja (core/catalog/wisps.mjs).
let wispList = [];
try {
  wispList =
    JSON.parse(await fs.readFile(path.join(root, "wisps.json"), "utf8"))
      .wisps ?? [];
} catch {}
// Sinergias, emblemas e o emblema que um aprimoramento dá: regra única em core/catalog/traits.mjs (mesma do motor e da interface).
const traitRules = traitBook(catalog);
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
    freshness: metaStore.freshness("builds"),
    games: meta.games,
    kinds: ITEM_KINDS,
    items: itemTiers(listed, stats).map((i) => ({
      ...i,
      icon: icons[i.id] ?? null,
    })),
  };
}
// Rodada e fase lidas dos arquivos que o próprio jogo grava. Ver FONTES-DE-DADOS.md.
const gameFiles = gameLog();
// Fonte GEP (banco do TFTAcademy, somente leitura): a única que observa ouro, nível, XP, loja e itens do jogador; obsoleta
// ou ausente, esses campos ficam desconhecidos (`noSource` diz o motivo). Não há leitura de tela.
const gep = gepReader({
  champions: new Set(catalog.champions.map((c) => c.apiName)),
  items: new Set(catalog.items.map((i) => i.apiName)),
  // Aprimoramentos (oferta e escolhidos) e Wisps da loja, mapeados aos ids do catálogo; o que não bate fica desconhecido.
  augments: new Set(augmentList.map((a) => a.id)),
  wisps: wispCatalog(catalog.items, itemCatalog),
});
const gepContext = gepContextFor(HERO_ID); // partida em andamento para a fonte GEP (app/state.mjs)
// O estado da partida (app/state.mjs): arquivos do jogo + GEP com uma fonte só por campo (core/state/precedence.mjs).
const stateHub = createStateHub({
  gameFiles,
  gep,
  onDivergence: (e) =>
    diag.write(
      "AVISO",
      `GEP e arquivo do jogo divergem em ${e.field}: gep=${JSON.stringify(e.gep)} arquivo=${JSON.stringify(e.base)} (vale ${e.active === "gep" ? "o GEP" : "o arquivo do jogo"})`,
    ),
});
const seenState = stateHub.seen;
// Últimos corpos de /api/state e do POST /api/recommend ao vivo, só em memória, para o overlay (GET /api/overlay).
const overlay = createOverlayFeed();
// O carrossel do estado (app/carousel-view.mjs): detecção, peças lidas e o que pegar, sobre a última análise do feed.
const carousel = carouselFeed({ overlay, emblems: traitRules.emblems });
// Início e fim de partida: zera o que pertence à partida anterior e avisa as telas pelo SSE.
// Tabuleiros finais dos 8 jogadores com a colocação oficial (validação do modelo de tabuleiro).
const lobbies = lobbyRecorder(path.join(root, "../data/lobby-boards.jsonl"));
// Modo treino (partida só do jogador, sem rivais) é detectado pelos dados (core/state/practice.mjs); `TFT_PRACTICE=1` o força
// quando a detecção falha. Nele a partida só encerra quando o jogo realmente fecha (match.mjs).
const PRACTICE_FORCED = process.env.TFT_PRACTICE === "1";
// Último Ao vivo de cada partida, congelado quando ela encerra (app/live-snapshot.mjs) para a interface revê-lo.
const liveSnapshots = createLiveSnapshots({
  dir: path.join(root, "../data/match-live"),
});
const matches = matchTracker(
  path.join(root, "../data/match-history.jsonl"),
  HERO_ID,
  {
    practice: PRACTICE_FORCED,
    liveSnapshots,
    onChange({ kind, record }) {
      // Congela o último Ao vivo desta partida: o quadro gravado até aqui, antes de qualquer leitura pós-fim.
      if (kind === "end") {
        const frozen = liveSnapshots.freeze(
          matches.status().id,
          overlay.liveFrame(),
        );
        if (!frozen)
          diag.write(
            "AVISO",
            `partida ${matches.status().id} encerrada sem Ao vivo para guardar`,
          );
      }
      // Só partida nova zera; "resume" (encerrada por engano e reaberta) mantém plano e caches.
      if (kind === "start") {
        recommender?.clear();
        // O plano não é zerado aqui: o estado é da partida (gameId) e "start" também dispara quando o servidor reinicia
        // no meio de uma partida, que deve continuar com o plano guardado em disco.
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
// Acompanha a partida mesmo sem nenhuma tela aberta, para o histórico não depender da interface. Laço protegido (`every`):
// o erro de uma rodada vai ao log e a seguinte roda; uma leitura que nunca responde é abandonada em 30 s.
async function watchMatch() {
  const [board, session] = await Promise.all([
    readBoardSnapshot().catch(() => null),
    lcu(),
  ]);
  matches.observe(
    board?.snapshot ?? null,
    board?.stat ?? null,
    session,
    gameSignals(),
  );
  // Partida de treino (um jogador só) não é lobby de 8: não entra nas colocações oficiais.
  if (
    board?.snapshot &&
    practiceSignal(board.snapshot, { forced: PRACTICE_FORCED }) === null
  )
    lobbies.observe(board.snapshot);
}
// Rodada da partida aberta segundo os arquivos do jogo (só se o arquivo é dela): rodada avançando prova que o jogo segue
// em andamento, para o treino não encerrar e para reabrir uma partida encerrada por engano (match.mjs).
function gameSignals() {
  const id = matches.status().id;
  if (id == null) return {};
  const game = gameFiles.status(id);
  return { stage: game.available ? game.stage : null };
}
every("acompanhamento da partida", 2000, watchMatch, { stuckMs: 30_000 });
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
  const [{ snapshot: read, stat }, session] = await Promise.all([
    readBoardSnapshot(),
    lcu(),
  ]);
  const age = Math.max(0, (Date.now() - stat.mtimeMs) / 1000);
  const sameGame = session?.gameId === read.gameId;
  const local = read.statsBlock.players.find(
    (p) => String(p.playerId) === HERO_ID,
  );
  const match = matches.observe(read, stat, session, gameSignals());
  // Partida de treino (sem rivais): o arquivo traz vida -99/1 e colocação 1 com o jogo rodando. O rastreador de partidas
  // já leu o arquivo cru acima; a análise recebe a vida do Hero normalizada e o valor lido fica em `practice.rawHealth`.
  const practice = practiceOf(read, HERO_ID, { forced: PRACTICE_FORCED }),
    snapshot = withPracticeHealth(read, HERO_ID, { forced: PRACTICE_FORCED });
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
      // Treino: o arquivo do tabuleiro só é regravado de tempos em tempos (capturas de 50 a 80 s entre si, sem rodada
      // de rival); a idade dele sozinha não diz que a partida parou.
      actionable:
        sameGame &&
        session.phase === "InProgress" &&
        (age < 120 || practice.active),
      practice,
      localPlayerId: local ? String(local.playerId) : null,
      // Peças em campo: ESTIMATIVA de último recurso, não leitura (jogar abaixo do nível, slot extra e invocações a
      // invalidam). Só entra na análise com levelEstimated = true; o nível observado/derivado vem do estado (app/state.mjs).
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
        "Banco adversário não capturado. A loja vem do GEP (TFTAcademy); sem ele ela fica desconhecida (o arquivo do tabuleiro não a traz).",
        "Pool estimado: bancos ocultos, duplicadores e slots reservados em lojas não observados.",
        "Economia, posições e counters são heurísticos; comps de meta usam a cópia de estatísticas disponível. Sem simulação de combate ou garantia de vitória.",
        "Emblemas, Wisps, invocações e regras especiais de traits não são simulados.",
      ],
      catalogSource: catalog.source,
      catalogDate: catalog.fetchedAt,
    },
  };
}
// Tempo das rotas /api/* (M0 da migração, ver ARQUITETURA.md): resumo por minuto no server.log (nível TEMPO) e, a cada
// análise calculada (sem acerto no cache), as etapas dela. Só mede e registra; não muda nenhuma resposta.
const timings = { since: Date.now(), routes: new Map() };
// Atraso do event loop, CPU, memória e gravações do cache de evidência por janela (mesma linha de resumo por minuto).
const loadMonitor = loadProbe();
function recordTiming(route, ms) {
  const list = timings.routes.get(route) ?? [];
  list.push(ms);
  timings.routes.set(route, list);
  if (Date.now() - timings.since < 60_000) return;
  const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  const parts = [...timings.routes].map(([name, xs]) => {
    xs.sort((a, b) => a - b);
    return `${name} n=${xs.length} p50=${q(xs, 0.5).toFixed(0)} p95=${q(xs, 0.95).toFixed(0)} max=${xs.at(-1).toFixed(0)}`;
  });
  diag.write(
    "TEMPO",
    `últimos ${Math.round((Date.now() - timings.since) / 1000)} s (ms): ${parts.join("; ")}`,
  );
  diag.write("TEMPO", `carga: ${loadLine()}`);
  timings.since = Date.now();
  timings.routes.clear();
}
// O corpo de GET /api/state, sem gravá-lo no feed do overlay. Serve a rota e o laço automático (app/auto-refresh.mjs), que
// por isso enxerga exatamente o que a interface vê.
let lastState = { at: 0, body: null };
async function buildStateBody() {
  const { metadata, snapshot } = await current();
  const { gepStatus, ...seenNow } = seenState(
    metadata.gameId,
    gepContext(metadata, snapshot),
  );
  streaks.observe({
    gameId: metadata.gameId,
    stage: seenNow.stage,
    hp: metadata.players.find((p) => p.id === HERO_ID)?.health,
  });
  const body = {
    ...metadata,
    screen: seenNow,
    // Estado normalizado (cada campo com valor, fonte, confiança e idade) e a divergência GEP x arquivo do jogo contada.
    gameState: {
      ...stateHub.gameState(seenNow, metadata.gameId),
      divergence: stateHub.divergence(),
    },
    // Fonte GEP (banco do TFTAcademy): ativo, obsoleto, ausente ou esquema-desconhecido, com o motivo e a idade do último evento.
    gepStatus,
    // Origem e estado bruto dos arquivos do jogo; `hints` são estimativas (voz de compra etc.), não dado observado.
    gameFiles: gameFiles.status(metadata.gameId),
    // Compras e fusões do TFT.log contra o tabuleiro: a reserva NÃO é reconstruível (o log não grava venda nem
    // movimento); `bench.upperBound` é só um teto. A reserva observada vem do GEP (`screen.sources.bench`); sem ele, fica sem fonte. Ver FONTES-DE-DADOS.md.
    unitLedger: gameFiles.ledger(
      metadata.gameId,
      snapshot.statsBlock.players.find((p) => String(p.playerId) === HERO_ID)
        ?.boardPieces ?? [],
    ),
    streak: streaks.current(),
    carousel: carousel(seenNow, metadata.gameId),
  };
  lastState = { at: Date.now(), body };
  return body;
}
// O pipeline da recomendação (app/recommend.mjs): o POST da interface e o laço automático o chamam e dividem os caches
// (`results` guarda as análises recentes por chave de análise).
const analysisResults = createRecentResults();
// A análise pesada roda numa thread (analysis-worker.mjs): HTTP e SSE continuam respondendo enquanto ela calcula.
// `TFT_ANALYSIS_WORKER=0` a desliga (a análise volta ao processo principal); `TFT_ANALYSIS_TIMEOUT_MS` muda o prazo de uma
// análise na thread (60 s). Se a thread cair ou não iniciar, a análise segue no processo principal (app/analysis-runner.mjs).
const analysisWorker =
  process.env.TFT_ANALYSIS_WORKER === "0"
    ? null
    : threadWorker({
        root,
        evidenceFile,
        budgetMs: EVIDENCE_BUDGET_MS,
        heroId: HERO_ID,
        timeoutMs: Number(process.env.TFT_ANALYSIS_TIMEOUT_MS) || 60_000,
        log: (level, text) => diag.write(level, text),
      });
recommender = createRecommender({
  analysisWorker,
  log: (level, text) => diag.write(level, text),
  heroId: HERO_ID,
  catalog,
  itemIds,
  plannerCatalog,
  localNames,
  augmentById,
  traitRules,
  capturesFile: path.join(root, "../data/scouting-captures.jsonl"),
  planLog,
  budgetMs: EVIDENCE_BUDGET_MS,
  // As cópias de meta são renovadas em segundo plano: o pipeline as lê a cada análise.
  get meta() {
    return meta;
  },
  get metaComps() {
    return metaComps;
  },
  get boardStats() {
    return boardStats;
  },
  get augmentStats() {
    return augmentStats;
  },
  current,
  replayState,
  seenState,
  gepContext,
  matches,
  planState,
  streaks,
  gameFiles,
  evidenceClient,
  overlay,
  results: analysisResults,
});
// O servidor conduz a análise sozinho durante a partida (sem a interface aberta): `TFT_AUTO_REFRESH=0` desliga o laço
// (volta a depender da interface), `TFT_AUTO_REFRESH_MS` muda o tick (3 s). Ver app/auto-refresh.mjs.
const AUTO_TICK_MS = Number(process.env.TFT_AUTO_REFRESH_MS) || 3000;
const auto = createAutoRefresh({
  // Há partida em andamento? A fase do cliente (em cache, renovada a cada 5 s) e, sem cliente, o rastreador de partidas.
  probe: async () => {
    const session = await lcu(),
      match = matches.status(),
      phase = session?.phase;
    return {
      inMatch:
        phase === "InProgress" ||
        phase === "Reconnect" ||
        (typeof phase !== "string" && match.status === "live"),
      gameId: match.id ?? session?.gameId ?? null,
    };
  },
  // O mesmo estado que a interface lê; se uma rota o montou há instantes, reaproveita (a interface aberta não dobra o custo).
  readState: async () =>
    lastState.body && Date.now() - lastState.at < AUTO_TICK_MS * 0.8
      ? lastState.body
      : overlay.recordState(await buildStateBody()),
  decisions: (gameId) => planState.decisions(gameId),
  refresh: async (decided) => {
    const stages = stageTimer(),
      t0 = performance.now(),
      done = await recommender.run(decided, { source: "auto", stages });
    if (done.status === 200 && !stages.cacheHit)
      diag.write(
        "TEMPO",
        `AUTO recomendação ${stages.text()} total=${(performance.now() - t0).toFixed(0)}${stages.note ? " " + stages.note : ""}${stages.evidence ? " " + stages.evidence.text() : ""} (ms)`,
      );
    return done;
  },
  results: analysisResults,
  intervalMs: AUTO_TICK_MS,
  minGapMs: AUTO_TICK_MS,
  report: recordTiming,
  log: (level, text) => diag.write(level, text),
});
// Resumo do laço no resumo por minuto do TEMPO (a linha de carga).
const loadLine = () =>
  `${loadMonitor.sample()}; ${explorerInstance?.takeStats() ?? "evidencia na thread de analise"}; ${auto.takeStats()}`;
// GET /api/health: de pé, há quanto tempo, atraso do loop agora, onde a análise roda e a idade do último ciclo de cada fonte.
const loopLag = loopLagProbe();
const healthBody = () => ({
  ok: true,
  pid: process.pid,
  port,
  now: new Date().toISOString(),
  uptimeS: Math.round(process.uptime()),
  loopLagMs: loopLag(),
  memoryMB: Math.round(process.memoryUsage().rss / 1048576),
  analysis: recommender.analyzer.status(),
  auto: auto.status(),
  match: matches.status().status,
  capture: captures.status(),
  sources: pulseHealth(),
});
handle = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const startedAt = performance.now();
  res.once("finish", () => {
    const ms = performance.now() - startedAt,
      route = `${req.method} ${(req.url ?? "").split("?")[0]}`;
    // /api/events é um fluxo SSE: o "fim" dele é o tempo de conexão, não de resposta.
    if (!route.includes(" /api/") || route.endsWith("/api/events")) return;
    recordTiming(route, ms);
    if (res.stages && !res.stages.cacheHit && res.statusCode === 200)
      diag.write(
        "TEMPO",
        `${route} ${res.stages.text()} json=${(res.jsonMs ?? 0).toFixed(0)} total=${ms.toFixed(0)} bytes=${res.jsonBytes ?? 0}${res.stages.note ? " " + res.stages.note : ""}${res.stages.evidence ? " " + res.stages.evidence.text() : ""} (ms)`,
      );
  });
  const json = (status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    const t0 = performance.now(),
      // `Uint8Array`/`Buffer`: JSON já serializado (a thread de análise o entrega pronto); nada de reserializar ~1 MB.
      body = data instanceof Uint8Array ? data : JSON.stringify(data);
    res.jsonMs = performance.now() - t0;
    res.jsonBytes = body.length;
    res.end(body);
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
          // Sinergia que o item dá a quem o equipa (emblemas); a interface soma com a regra de core/catalog/traits.mjs.
          trait: traitRules.emblems.get(i.apiName) ?? null,
        })),
        traits: catalog.traits.map((t) => ({
          name: t.name,
          breakpoints: traitRules.thresholds(t.name),
          icon: icons["trait:" + t.apiName] ?? null,
        })),
        wisps: wispList.map((w) => ({
          id: w.id,
          name: w.name,
          namePt: w.namePt,
          desc: w.descPt ?? w.desc,
          image: icons[w.iconKey] ?? null,
          tipo: w.tipo,
          categoria: w.categoria,
          melhorado: w.melhorado,
          consolacao: w.consolacao,
          condicional: w.condicional,
          condicaoTipo: w.condicaoTipo,
          condicao: w.condicao,
          exigePosicao: w.exigePosicao,
          custo: w.custo,
          custoNota: w.custoNota,
          somePorVida: w.somePorVida,
        })),
      });
    if (req.method === "GET" && url.pathname === "/api/comps")
      return json(200, {
        source: metaComps.label,
        fetchedAt: metaComps.fetchedAt,
        freshness: metaStore.freshness("comps"),
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
      // `liveSnapshot` reflete o que existe agora (partida antiga cujo arquivo saiu do limite deixa de ter); registro sem ele
      // (anterior a este recurso) mostra "sem dados ao vivo guardados".
      return json(200, {
        matches: matches.history().map(({ liveSnapshot, ...r }) => {
          const held = liveSnapshots.info(r.gameId);
          return held ? { ...r, liveSnapshot: held } : r;
        }),
      });
    // O último Ao vivo guardado de uma partida encerrada: leitura pura (nada é calculado nem analisado). 404 se não há.
    if (req.method === "GET" && url.pathname === "/api/match-live") {
      const id = url.searchParams.get("id") ?? "";
      if (!/^\d+$/.test(id)) return json(400, { error: "Partida inválida." });
      const held = liveSnapshots.read(id);
      return held
        ? json(200, held)
        : json(404, { error: "Esta partida não tem dados ao vivo guardados." });
    }
    if (req.method === "GET" && url.pathname === "/api/items")
      return json(200, itemsPayload());
    if (req.method === "GET" && url.pathname === "/api/state")
      return json(200, overlay.recordState(await buildStateBody()));
    // Overlay: só devolve o último estado e a última recomendação (da interface ou do laço automático, em memória), sem
    // análise nem efeito colateral.
    if (req.method === "GET" && url.pathname === "/api/overlay")
      return json(
        200,
        overlay.snapshotJson({ since: url.searchParams.get("since") }),
      );
    // Saúde: o servidor está de pé e cada fonte de acompanhamento ainda gira? (idade do último ciclo de cada uma)
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(200, healthBody());
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
      // O pipeline mora em app/recommend.mjs e é o mesmo que o laço automático roda sozinho (app/auto-refresh.mjs).
      const stages = (res.stages = stageTimer());
      const done = await recommender.run(JSON.parse(body), {
        source: "ui",
        stages,
      });
      // Da thread de análise vem o JSON pronto (`bytes`); no processo principal, o objeto (serializar cede o loop antes).
      if (!done.bytes) await yieldToLoop();
      return json(done.status, done.bytes ?? done.data);
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
    // Interface (./v2) e núcleo puro (./core, o mesmo que o servidor importa): estáticos, só tipos web.
    if (
      req.method === "GET" &&
      (await sendStatic(res, root, url.pathname, json))
    )
      return;
    const files = {
      // Módulos puros de economia: o mock da interface usa as mesmas contas do servidor.
      "/economy.mjs": "economy.mjs",
      "/rules.mjs": "rules.mjs",
      "/live-mock.js": "live-mock.js",
      "/live-mock.html": "live-mock.html",
      "/live-mock-base.json": "live-mock-base.json",
    };
    if (req.method === "GET" && files[url.pathname]) {
      // Lê antes de escrever o cabeçalho: uma falha de leitura responde o erro, não uma resposta pela metade.
      const body = await fs.readFile(path.join(root, files[url.pathname]));
      res.writeHead(200, {
        "Content-Type": /[.]m?js$/.test(url.pathname)
          ? "text/javascript"
          : url.pathname.endsWith(".css")
            ? "text/css"
            : url.pathname.endsWith(".json")
              ? "application/json"
              : "text/html; charset=utf-8",
      });
      return res.end(body);
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
// Rotas prontas: o servidor passa a conduzir a análise sozinho durante a partida (sem a interface aberta).
if (analysisWorker) {
  recommender.analyzer.start(); // aquece a thread (carrega o motor e o catálogo) antes do primeiro pedido
  diag.write(
    "INFO",
    "análise pesada na thread de análise (TFT_ANALYSIS_WORKER=0 a desliga)",
  );
} else
  diag.write(
    "INFO",
    "TFT_ANALYSIS_WORKER=0: a análise roda no processo principal (o servidor não responde enquanto ela calcula)",
  );
if (process.env.TFT_AUTO_REFRESH === "0")
  diag.write(
    "INFO",
    "laço automático desligado (TFT_AUTO_REFRESH=0): a análise só se renova com a interface aberta",
  );
else auto.start();
