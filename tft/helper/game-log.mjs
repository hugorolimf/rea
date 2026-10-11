// Fontes estruturadas que o próprio jogo grava em disco (sem OCR, sem captura de tela, sem ler a memória do jogo):
//  - `%LOCALAPPDATA%/TFT/.sentry-native/<execução>.run/__sentry-event`: contexto do relatório de falhas (Sentry), regravado
//    pelo jogo a cada mudança de fase/rodada. Traz game.id, game.queue, set_name, game.tft.phase e game.tft.round ("2-4").
//  - `%LOCALAPPDATA%/TFT/Saved/Logs/TFT.log`: log do motor. Não grava ouro, nível, XP, reserva, loja nem itens do banco;
//    só deixa pistas indiretas (voz de compra, de estrela, item indo para o banco). Ficam em `hints`, marcadas como
//    estimativa, e nunca alimentam a análise como dado observado. As compras e fusões (com o id estável de cada
//    entidade) alimentam o livro-razão de `unit-ledger.mjs`, que fecha o ADQUIRIDO mas não a reserva: o log não grava
//    venda nem movimento tabuleiro<->reserva (`gameLog().ledger(...)`).
// Detalhes, latência e limites de cada dado: FONTES-DE-DADOS.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseStage, stageText } from "./core/state/clock.mjs";
import { buildLedger, ledgerStatus } from "./unit-ledger.mjs";

/** Execuções do jogo guardadas para o livro-razão (uma partida com quedas tem poucas). */
const MAX_RUNS = 6;

/** Pasta de dados do cliente TFT (onde ficam .sentry-native e Saved/Logs). */
export function defaultTftDir() {
  const base =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "TFT");
}

/**
 * Valor de uma etiqueta do evento do Sentry. O arquivo é MessagePack: chave e valor são strings (fixstr 0xa0-0xbf
 * ou str8 0xd9+tamanho). Devolve null se a chave não existe ou o arquivo foi gravado pela metade.
 */
export function readTag(buffer, key) {
  const k = Buffer.from(key, "utf8");
  let from = 0;
  for (;;) {
    const at = buffer.indexOf(k, from);
    if (at < 0) return null;
    from = at + 1;
    const fix = at > 0 && buffer[at - 1] === (0xa0 | k.length) && k.length < 32;
    const str8 =
      at > 1 && buffer[at - 2] === 0xd9 && buffer[at - 1] === k.length;
    if (!fix && !str8) continue;
    const p = at + k.length,
      head = buffer[p];
    let start, length;
    if (head !== undefined && (head & 0xe0) === 0xa0) {
      length = head & 0x1f;
      start = p + 1;
    } else if (head === 0xd9 && p + 1 < buffer.length) {
      length = buffer[p + 1];
      start = p + 2;
    } else return null;
    if (start + length > buffer.length) return null;
    return buffer.toString("utf8", start, start + length);
  }
}

/** "Planning", "PlanningArrival", "Combat", "CombatCeremony", "Draft"... → planning | combat | draft | other. */
export function phaseKind(phase) {
  if (typeof phase !== "string" || !phase) return null;
  if (phase.startsWith("Planning")) return "planning";
  if (phase.startsWith("Combat")) return "combat";
  if (phase.startsWith("Draft")) return "draft";
  return "other";
}

/** Contexto da partida a partir dos bytes de `__sentry-event`; null se não houver nenhum campo de partida. */
export function parseSentryEvent(buffer) {
  const gameId = readTag(buffer, "game.id"),
    round = readTag(buffer, "game.tft.round"),
    phase = readTag(buffer, "game.tft.phase"),
    queueId = readTag(buffer, "game.queue"),
    set = readTag(buffer, "set_name");
  if (!gameId && !round && !phase) return null;
  const at = parseStage(round);
  return {
    gameId: gameId ?? null,
    queueId: queueId ?? null,
    set: set ?? null,
    phase: phase ?? null,
    phaseKind: phaseKind(phase),
    // Rodada como o jogo escreve ("2-4"); nula quando o valor não tem o formato estágio-rodada.
    stage: stageText(at),
    stageNumber: at?.stage ?? null,
    roundNumber: at?.round ?? null,
  };
}

const LOG_PREFIX =
  /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]\[ *\d+\]/;
const PURCHASE =
  /Trigger\[Audio\.Event\.VO\.Unit\.Purchase\] Actor\[TFTCharacter_(\d+) \{([^}]+)\}\]/;
const PURCHASE_BLOCKED =
  /Actor\[TFTCharacter_(\d+) \{([^}]+)\}\] and Event\[Audio\.Event\.VO\.Unit\.Purchase\] was blocked/;
const STAR_UP =
  /Trigger\[Audio\.Event\.VO\.Unit\.StarUp\.([23])Star\] Actor\[TFTCharacter_(\d+) \{([^}]+)\}\]/;
const STAR_UP_BLOCKED =
  /Actor\[TFTCharacter_(\d+) \{([^}]+)\}\] and Event\[Audio\.Event\.VO\.Unit\.StarUp\.([23])Star\] was blocked/;

/** Instante do prefixo do log do motor (UTC) em ISO; null se a linha não tem prefixo. */
export function logTime(line) {
  const m = LOG_PREFIX.exec(line);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : null;
}

/**
 * Evento reconhecido numa linha do TFT.log, ou null. `id` é o campeão (`DA_18_Elise`), `actor` o id estável da entidade
 * (`TFTCharacter_<actor>`, único na execução do jogo). `blocked` = a voz foi cortada por outra, mas o evento ocorreu.
 */
export function parseLogLine(line) {
  const at = logTime(line);
  if (!at) return null;
  let m;
  if ((m = PURCHASE.exec(line)))
    return { type: "purchase", id: m[2], actor: m[1], at, blocked: false };
  if ((m = PURCHASE_BLOCKED.exec(line)))
    return { type: "purchase", id: m[2], actor: m[1], at, blocked: true };
  if ((m = STAR_UP.exec(line)))
    return {
      type: "starUp",
      id: m[3],
      actor: m[2],
      star: Number(m[1]),
      at,
      blocked: false,
    };
  if ((m = STAR_UP_BLOCKED.exec(line)))
    return {
      type: "starUp",
      id: m[2],
      actor: m[1],
      star: Number(m[3]),
      at,
      blocked: true,
    };
  if (line.includes("'ItemFlyToBench_INST'"))
    return { type: "itemToBench", at };
  if (line.includes("Switched to music [MS_Music_Set18_Gameplay_Carousel]"))
    return { type: "carousel", at };
  // O jogo é montado no cliente ([Client]); o [Standalone] é o menu principal e aparece antes e depois da partida.
  if (
    line.includes("[Client] TFTAugmentPlayerSubsystem") &&
    line.includes("Event[BeginGame]")
  )
    return { type: "gameStart", at };
  if (
    line.includes("TFTAugmentPlayerSubsystem") &&
    line.includes("Event[EndGame]")
  )
    return { type: "gameEnd", at };
  return null;
}

const emptyHints = () => ({
  startedAt: null,
  ended: false,
  purchases: [],
  starUps: [],
  itemsReceived: 0,
  carousels: 0,
});

/** Soma um evento nas pistas da partida corrente (zera no início de uma nova). */
export function applyLogEvent(hints, event) {
  switch (event.type) {
    case "gameStart":
      return { ...emptyHints(), startedAt: event.at };
    case "gameEnd":
      return { ...hints, ended: true };
    case "purchase":
      hints.purchases.push({
        id: event.id,
        at: event.at,
        blocked: event.blocked,
      });
      return hints;
    case "starUp":
      hints.starUps.push({
        id: event.id,
        star: event.star,
        at: event.at,
        blocked: event.blocked,
      });
      return hints;
    case "itemToBench":
      hints.itemsReceived++;
      return hints;
    case "carousel":
      hints.carousels++;
      return hints;
    default:
      return hints;
  }
}

/**
 * Acompanha as duas fontes. `status(expectedGameId)` lê sob demanda (no máximo a cada `minIntervalMs`), tolera
 * arquivo ausente, gravado pela metade, rotacionado ou truncado, e nunca lança.
 */
export function gameLog({
  dir = defaultTftDir(),
  minIntervalMs = 400,
  now = Date.now,
} = {}) {
  const sentryRoot = path.join(dir, ".sentry-native"),
    logFile = path.join(dir, "Saved", "Logs", "TFT.log");
  let readAt = 0,
    context = null,
    contextError = null,
    contextFile = null,
    hints = emptyHints(),
    offset = 0,
    birth = null,
    pending = Buffer.alloc(0),
    logError = null,
    // Execuções do jogo vistas no log, com os eventos de unidade de cada uma (livro-razão). Uma partida pode ter mais de
    // uma (queda e reconexão); `gameId` é preenchido quando o arquivo de contexto confirma a que partida pertence.
    runs = [];

  /** Guarda o evento de unidade na execução corrente (cria uma se o log começou sem `BeginGame`). */
  function recordRun(event) {
    if (event.type === "gameStart") {
      runs.push({ birth, startedAt: event.at, gameId: null, events: [] });
      if (runs.length > MAX_RUNS) runs.shift();
    } else if (event.type === "purchase" || event.type === "starUp") {
      if (!runs.length || runs[runs.length - 1].birth !== birth)
        runs.push({ birth, startedAt: event.at, gameId: null, events: [] });
      runs[runs.length - 1].events.push(event);
    }
  }
  /** Liga a última execução à partida do arquivo de contexto, se ele foi regravado depois do início dela. */
  function bindRun() {
    const last = runs[runs.length - 1];
    if (!last || last.gameId || !context?.gameId) return;
    if (Date.parse(context.writtenAt) >= Date.parse(last.startedAt))
      last.gameId = context.gameId;
  }

  /** Arquivo `__sentry-event` mais recente entre as execuções (uma pasta .run por processo do jogo). */
  function newestEvent() {
    let best = null;
    for (const entry of fs.readdirSync(sentryRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith(".run")) continue;
      const file = path.join(sentryRoot, entry.name, "__sentry-event");
      try {
        const { mtimeMs } = fs.statSync(file);
        if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
      } catch {}
    }
    return best;
  }
  function readContext() {
    try {
      const found = newestEvent();
      if (!found) {
        context = null;
        contextFile = null;
        contextError = "nenhuma execução do jogo em .sentry-native";
        return;
      }
      contextFile = found.file;
      const parsed = parseSentryEvent(fs.readFileSync(found.file));
      // Gravação pela metade: mantém a última leitura boa em vez de apagá-la.
      if (parsed)
        context = {
          ...parsed,
          writtenAt: new Date(found.mtimeMs).toISOString(),
        };
      contextError = null;
    } catch (e) {
      context = null;
      contextError =
        e.code === "ENOENT" ? "pasta .sentry-native ausente" : e.message;
    }
  }
  function readLog() {
    try {
      const stat = fs.statSync(logFile);
      if (
        birth !== null &&
        (stat.birthtimeMs !== birth || stat.size < offset)
      ) {
        // Rotação (arquivo novo) ou truncamento: recomeça do início. Truncar o mesmo arquivo reler seus eventos, então as
        // execuções dele saem; na rotação elas ficam (a partida pode continuar na execução seguinte, após uma queda).
        if (stat.birthtimeMs === birth)
          runs = runs.filter((r) => r.birth !== birth);
        offset = 0;
        pending = Buffer.alloc(0);
        hints = emptyHints();
      }
      birth = stat.birthtimeMs;
      if (stat.size > offset) {
        const fd = fs.openSync(logFile, "r");
        try {
          const chunk = Buffer.alloc(1 << 20);
          while (offset < stat.size) {
            const n = fs.readSync(
              fd,
              chunk,
              0,
              Math.min(chunk.length, stat.size - offset),
              offset,
            );
            if (n <= 0) break;
            offset += n;
            const data = Buffer.concat([pending, chunk.subarray(0, n)]);
            const cut = data.lastIndexOf(0x0a);
            pending = cut < 0 ? data : data.subarray(cut + 1);
            if (cut < 0) continue;
            for (const line of data.toString("utf8", 0, cut).split(/\r?\n/)) {
              const event = line.includes("[")
                ? parseLogLine(line.replace(/^﻿/, ""))
                : null;
              if (event) {
                hints = applyLogEvent(hints, event);
                recordRun(event);
              }
            }
          }
        } finally {
          fs.closeSync(fd);
        }
      }
      logError = null;
    } catch (e) {
      logError = e.code === "ENOENT" ? "TFT.log ausente" : e.message;
    }
  }
  return {
    /**
     * Livro-razão das unidades da partida (compras e fusões do TFT.log) confrontado com `boardPieces` do jogador.
     * Só vale para execuções do jogo ligadas à partida pelo arquivo de contexto. NÃO é a reserva: o log não grava venda
     * nem movimento (ver `unit-ledger.mjs`); `bench.upperBound` é um teto e `bench.reconstructable` é false.
     */
    ledger(expectedGameId = null, boardPieces = []) {
      const gameId = String(expectedGameId ?? context?.gameId ?? ""),
        mine = runs.filter((r) => r.gameId === gameId);
      if (!gameId || !mine.length)
        return {
          available: false,
          source: "tft-log",
          gameId: gameId || null,
          runs: 0,
        };
      return {
        available: true,
        gameId,
        runs: mine.length,
        ...ledgerStatus(buildLedger(mine), boardPieces),
      };
    },
    /**
     * Estado lido dos arquivos do jogo. `expectedGameId` (do cliente LCU) confere se o arquivo é da partida em
     * andamento: com outra partida, `stage`/`phase` vêm nulos e `stale` fica true (nunca se usa rodada de outra partida).
     */
    status(expectedGameId = null) {
      if (now() - readAt >= minIntervalMs) {
        readAt = now();
        readContext();
        readLog();
        bindRun();
      }
      const sameGame =
        context && expectedGameId != null
          ? String(expectedGameId) === context.gameId
          : null;
      const usable = context !== null && sameGame !== false;
      return {
        available: usable,
        source: usable ? "sentry-event" : null,
        file: contextFile,
        error: contextError,
        stale: context !== null && sameGame === false,
        sameGame,
        gameId: context?.gameId ?? null,
        queueId: context?.queueId ?? null,
        set: context?.set ?? null,
        phase: usable ? context.phase : null,
        phaseKind: usable ? context.phaseKind : null,
        stage: usable ? context.stage : null,
        stageNumber: usable ? context.stageNumber : null,
        roundNumber: usable ? context.roundNumber : null,
        writtenAt: context?.writtenAt ?? null,
        hints: {
          source: "tft-log",
          reliability: "estimated",
          error: logError,
          ...hints,
        },
      };
    },
  };
}

/**
 * Junta o estado do leitor de tela com o do jogo: a rodada do arquivo do jogo vale mais que a do OCR; ouro, nível,
 * XP, banco de itens e loja continuam vindo da tela. `sources` diz de onde veio cada campo (null = não lido).
 */
export function mergeSources(screen, game) {
  const stageFromGame = game?.available && game.stage ? game.stage : null,
    from = (value, source) =>
      value === null || value === undefined ? null : source;
  return {
    ...screen,
    stage: stageFromGame ?? screen.stage ?? null,
    phase: game?.available ? game.phase : null,
    phaseKind: game?.available ? game.phaseKind : null,
    sources: {
      stage: stageFromGame ? "game-log" : from(screen.stage, "screen"),
      phase: game?.available && game.phase ? "game-log" : null,
      gold: from(screen.gold, "screen"),
      level: from(screen.level, "screen"),
      xp: from(screen.xp, "screen"),
      items: from(screen.bank, "screen"),
      shop: from(screen.shop, "screen"),
      // Reserva: sem fonte própria aqui. Só o GEP fresco a informa (mergeGep); a entrada manual foi removida.
      bench: null,
    },
  };
}
