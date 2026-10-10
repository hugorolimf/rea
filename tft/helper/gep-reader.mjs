// Fonte GEP (Overwolf Game Events Provider) lida do banco que o TFTAcademy grava: ouro, nível/XP, loja, reserva (bench) e
// banco de itens DO PRÓPRIO jogador, sem leitura de tela. Esquema, mapeamento, frescor e limites: FONTES-DE-DADOS.md,
// seção "GEP / TFTAcademy".
//
// Regras desta fonte (não negociáveis):
//  - Somente leitura: o banco é aberto com `readOnly` (ou `immutable=1` se nenhum processo o tem aberto, para não criar
//    arquivos -wal/-shm na pasta do TFTAcademy). Nunca se grava, nem se executa o Overwolf ou o TFTAcademy.
//  - Só o jogador local: as consultas pedem apenas as chaves abaixo (`KEYS`). Nunca se lê `opponent_board_pieces`,
//    `battle_stats`, `round_outcome`, aprimoramentos nem nada de rivais. `item_bench` traz os 8 jogadores: só a linha do
//    jogador local (identificado por `roster.player_status[].localplayer`) é guardada, o resto é descartado na hora.
//  - Nada é inventado: valor ausente, inválido ou fora do catálogo vira desconhecido (null / contado em `unknown`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { CONSUMABLE } from "./item-tiers.mjs";

/** Silêncio máximo (ms) do banco da partida para a fonte ainda valer. Ver "Frescor" em FONTES-DE-DADOS.md. */
export const GEP_STALE_MS = 60_000;
const MIN_INTERVAL_MS = 1000,
  BUSY_TIMEOUT_MS = 150,
  ERROR_BACKOFF_MS = 5000,
  BATCH = 2000,
  SHOP_SLOTS = 5;
/** Eventos lidos (`feature.key`). Qualquer outra chave nunca é selecionada: rivais e aprimoramentos ficam de fora. */
const KEYS = new Map([
  ["me.gold", "gold"],
  ["me.xp", "xp"],
  ["store.shop_pieces", "shop"],
  ["store.shop_visible", "shopVisible"],
  ["bench.bench_pieces", "bench"],
  ["bench.item_bench", "itemBench"],
  ["match_info.round_type", "roundType"],
  ["match_info.match_state", "matchState"],
  ["roster.player_status", "roster"],
]);
const KEY_NAMES = [...new Set([...KEYS.keys()].map((k) => k.split(".")[1]))];
const REQUIRED = {
  events: ["id", "game_id", "timestamp", "key", "data"],
  games: ["id", "started_at"],
};

/** Caminho do banco do TFTAcademy (`TFT_GEP_DB` troca, para testes). */
export function defaultGepDb() {
  if (process.env.TFT_GEP_DB) return process.env.TFT_GEP_DB;
  const base =
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "TFTAcademy", "tft-events.db");
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing dos payloads (puros). O GEP grava texto JSON; alguns campos vêm em JSON dentro de JSON ("parse it twice").

/** JSON do texto; se o resultado for uma string que também é um objeto JSON, abre de novo. `undefined` se inválido. */
export function parseJson(text) {
  if (typeof text !== "string") return undefined;
  try {
    const value = JSON.parse(text);
    if (typeof value === "string" && /^\s*[{[]/.test(value)) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  } catch {
    return undefined;
  }
}

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => (typeof v === "string" ? v.trim() : "");
const int = (v) => {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\s*\d+\s*$/.test(v)
        ? Number(v)
        : NaN;
  return Number.isInteger(n) ? n : null;
};

/**
 * `me.gold`: o jogo manda o número como texto ("2") e `{}` quando não há valor. `{}` aparece no começo da partida e
 * quando o ouro chega a 0 (observado: 2 → 1 → `{}` depois de duas compras de 1 ouro); o reducer decide qual dos dois é.
 * Devolve `{value}`, `{empty: true}` ou `null` (inválido).
 */
export function parseGold(data) {
  const v = parseJson(data);
  if (v === undefined) return null;
  if (v === null || v === "" || (isPlain(v) && !Object.keys(v).length))
    return { empty: true };
  const n = int(v);
  return n !== null && n >= 0 && n <= 999 ? { value: n } : null;
}

/** `me.xp` `{level, current_xp, xp_max}` → `{level, xp: "atual/total"|null}`; `xp_max` 0 ou ausente (nível máximo) = sem barra. */
export function parseXp(data) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const level = int(v.level),
    current = int(v.current_xp),
    max = int(v.xp_max);
  if (level === null || level < 1 || level > 11) return null;
  return {
    level,
    xp:
      current !== null && max !== null && max > 0 && current <= max
        ? `${current}/${max}`
        : null,
  };
}

/** `match_info.round_type` → `{stage: "1-2", name}`; estágio fora do formato S-R é ignorado. */
export function parseRoundType(data) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const m = /^(\d+)-(\d+)$/.exec(text(v.stage));
  return m && m[1] !== "0"
    ? { stage: `${Number(m[1])}-${Number(m[2])}`, name: text(v.name) || null }
    : null;
}

const asBool = (v) =>
  v === true || v === "true"
    ? true
    : v === false || v === "false"
      ? false
      : null;

/**
 * `store.shop_pieces` → 5 espaços. Cada um: carta `{text, id, known}` (`id` null se o nome não está no catálogo),
 * `null` para vendida ("Sold") ou ausente. Devolve null se o payload não é um objeto de espaços.
 */
export function parseShop(data, isChampion = () => true) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const slots = [];
  for (let i = 1; i <= SHOP_SLOTS; i++) {
    const name = text(v[`slot_${i}`]?.name);
    slots.push(
      !name || name === "Sold"
        ? null
        : { text: name, id: isChampion(name) ? name : null, source: "gep" },
    );
  }
  return slots;
}

/**
 * `bench.bench_pieces` (`cell_N: {name, level, item_1..3}`) → peças da reserva por célula. Nome fora do catálogo vai para
 * `unknown`. Payload vazio (`{}`) é reserva vazia, não desconhecida.
 */
export function parseBench(data, isChampion = () => true, isItem = () => true) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const units = [],
    unknown = [];
  for (const [cell, piece] of Object.entries(v)) {
    const at = /^cell_(\d+)$/.exec(cell)?.[1],
      name = text(piece?.name);
    if (at === undefined || !name) continue;
    if (!isChampion(name)) {
      unknown.push(name);
      continue;
    }
    const stars = int(piece.level);
    units.push({
      id: name,
      stars: stars !== null && stars >= 1 && stars <= 4 ? stars : null,
      items: [piece.item_1, piece.item_2, piece.item_3]
        .map(text)
        .filter((n) => n && isItem(n)),
      cell: Number(at),
      source: "gep",
    });
  }
  return { units: units.sort((a, b) => a.cell - b.cell), unknown };
}

/** Identidade do jogador local no `roster.player_status` (`localplayer: true`); null se não há exatamente um. */
export function parseLocalIdentity(data) {
  const v = parseJson(data);
  if (!isPlain(v)) return null;
  const mine = Object.entries(v).filter(([, p]) => p?.localplayer === true);
  return mine.length === 1
    ? { name: mine[0][0], tag: text(mine[0][1].tag_line) }
    : null;
}

const same = (a, b) =>
  String(a ?? "")
    .normalize("NFC")
    .toLowerCase() ===
  String(b ?? "")
    .normalize("NFC")
    .toLowerCase();

/**
 * `bench.item_bench`: array com a linha de CADA jogador (`summoner`, `tag_line`, `bench_items: [{name, count}]`) em ordem
 * instável. Só a linha da identidade local é lida. `found` é false sem identidade ou sem uma única linha dela
 * (desconhecido: nunca vira "banco vazio"). `bank` repete o item `count` vezes, como o leitor de tela; `items` tira os
 * consumíveis; `removers` soma os removedores; `unknown` conta os nomes fora do catálogo.
 */
export function parseItemBench(data, identity, isItem = () => true) {
  const v = parseJson(data);
  if (!Array.isArray(v) || !identity) return { found: false };
  const rows = v.filter(
    (r) =>
      isPlain(r) &&
      same(r.summoner, identity.name) &&
      same(r.tag_line, identity.tag),
  );
  if (rows.length !== 1 || !Array.isArray(rows[0].bench_items))
    return { found: false };
  const bank = [];
  let unknown = 0,
    removers = 0;
  for (const entry of rows[0].bench_items) {
    const name = text(entry?.name),
      count = int(entry?.count);
    if (!name || count === null || count < 1 || count > 60) {
      unknown++;
      continue;
    }
    if (!isItem(name)) {
      unknown += count;
      continue;
    }
    for (let i = 0; i < count; i++) bank.push(name);
    if (/ItemRemover/.test(name)) removers += count;
  }
  return {
    found: true,
    bank,
    items: bank.filter((id) => !CONSUMABLE.test(id)),
    removers,
    unknown,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado da partida: reduz os eventos (um por linha, em ordem de id) para o último valor de cada campo.

/** Estado vazio de uma partida. */
export function emptyGepState() {
  return {
    rows: 0,
    lastId: 0,
    roundSeen: false,
    ended: false,
    identity: null,
    pendingItemBench: null, // texto cru do último item_bench visto antes da identidade; descartado ao resolver
    gold: null,
    level: null,
    xp: null,
    stage: null,
    shop: null,
    shopVisible: null,
    bench: null,
    items: null,
  };
}

const stamp = (value, ts, extra = {}) => ({ value, ts, ...extra });

function applyItemBench(state, data, ts, env) {
  const r = parseItemBench(data, state.identity, env.isItem);
  if (!r.found) return false;
  state.items = stamp(r.items, ts, {
    bank: r.bank,
    removers: r.removers,
    unknown: r.unknown,
  });
  return true;
}

/**
 * Aplica uma linha `{id, ts, feature, key, data}` ao estado. `env` = `{isChampion, isItem}` (catálogo; sem ele aceita tudo).
 * Linhas de chaves fora de `KEYS` são ignoradas aqui também (defesa em profundidade além do filtro da consulta).
 */
export function applyGepEvent(state, row, env = {}) {
  const kind =
    KEYS.get(`${row.feature}.${row.key}`) ??
    (row.feature == null ? KEYS.get(fallbackKey(row.key)) : undefined);
  state.lastId = Math.max(state.lastId, row.id);
  if (!kind) return state;
  state.rows++;
  const ts = row.ts;
  switch (kind) {
    case "gold": {
      const g = parseGold(row.data);
      if (g?.value !== undefined) state.gold = stamp(g.value, ts);
      // `{}` = 0 só com a partida em andamento (depois de uma rodada e antes do fim); no reset do começo/fim é desconhecido.
      else if (g?.empty)
        state.gold =
          state.roundSeen && !state.ended
            ? stamp(0, ts, { inferredZero: true })
            : null;
      break;
    }
    case "xp": {
      const x = parseXp(row.data);
      if (x) {
        state.level = stamp(x.level, ts);
        state.xp = x.xp ? stamp(x.xp, ts) : null;
      }
      break;
    }
    case "roundType": {
      const r = parseRoundType(row.data);
      if (r) {
        state.stage = stamp(r.stage, ts, { name: r.name });
        state.roundSeen = true;
      }
      break;
    }
    case "matchState": {
      const inProgress = asBool(parseJson(row.data)?.in_progress);
      if (inProgress === true) state.ended = false;
      else if (inProgress === false) state.ended = true;
      break;
    }
    case "shopVisible":
      state.shopVisible = asBool(parseJson(row.data)) ?? state.shopVisible;
      break;
    case "shop": {
      const shop = parseShop(row.data, env.isChampion);
      if (shop) state.shop = stamp(shop, ts);
      break;
    }
    case "bench": {
      const b = parseBench(row.data, env.isChampion, env.isItem);
      if (b) state.bench = stamp(b.units, ts, { unknown: b.unknown.length });
      break;
    }
    case "roster": {
      const id = parseLocalIdentity(row.data);
      if (id) {
        const changed =
          !state.identity ||
          !same(state.identity.name, id.name) ||
          !same(state.identity.tag, id.tag);
        state.identity = id;
        if (changed && state.pendingItemBench) {
          const pending = state.pendingItemBench;
          if (applyItemBench(state, pending.data, pending.ts, env))
            state.pendingItemBench = null;
        }
      }
      break;
    }
    case "itemBench":
      if (!applyItemBench(state, row.data, ts, env)) {
        // Sem identidade ainda: guarda o texto só para tentar de novo quando o roster chegar.
        state.pendingItemBench = state.identity ? null : { data: row.data, ts };
      } else state.pendingItemBench = null;
      break;
  }
  return state;
}

const fallbackKey = (key) =>
  ({
    gold: "me.gold",
    xp: "me.xp",
    shop_pieces: "store.shop_pieces",
    shop_visible: "store.shop_visible",
    bench_pieces: "bench.bench_pieces",
    item_bench: "bench.item_bench",
    round_type: "match_info.round_type",
    match_state: "match_info.match_state",
    player_status: "roster.player_status",
  })[key];

// ---------------------------------------------------------------------------------------------------------------------
// Avaliação: dado o estado, a partida e o relógio, o que vale agora (puro).

/** Dígitos do id da partida em `match_id` ("BR1_3282025760" → "3282025760"); null se o formato é outro. */
export const matchIdDigits = (matchId) =>
  /^[A-Za-z0-9]+_(\d{5,})$/.exec(text(matchId))?.[1] ?? null;

const ageMs = (ts, now) =>
  Number.isFinite(ts) ? Math.max(0, now - ts * 1000) : null;

/**
 * Resultado público da fonte. `ctx` = `{gameId, inMatch, local: {name, tag}, set}` (tudo opcional):
 *  - `gameId`: partida em andamento (LCU/arquivo do jogo); com `match_id` gravado, os dois precisam coincidir;
 *  - `inMatch`: false fora de partida; null/undefined = fase desconhecida (não bloqueia);
 *  - `local`: nome e tag do jogador local conforme o servidor; se divergir do roster, o banco de itens fica desconhecido;
 *  - `set`: número do set esperado (18).
 * `state` ∈ ativo | obsoleto | ausente | esquema-desconhecido; `reason` diz o motivo. Só `ativo` traz `fields`.
 */
export function evaluateGep(
  snap,
  ctx = {},
  now = Date.now(),
  staleMs = GEP_STALE_MS,
) {
  const base = {
    source: "gep",
    confidence: "observed",
    state: "ausente",
    reason: null,
    available: false,
    staleMs,
    fields: null,
  };
  if (!snap || snap.error) {
    const e = snap?.error ?? { state: "ausente", reason: "ainda-nao-lido" };
    return {
      ...base,
      state: e.state,
      reason: e.reason,
      detail: e.detail ?? null,
    };
  }
  const g = snap.game,
    out = {
      ...base,
      gameId: matchIdDigits(g.matchId),
      binding: matchIdDigits(g.matchId) ? "match_id" : "recencia",
      setNumber: g.set ?? null,
      rows: snap.state.rows,
      catchingUp: snap.catchingUp === true,
      lastEventAt: snap.lastTs
        ? new Date(snap.lastTs * 1000).toISOString()
        : null,
      lastEventAgeMs: ageMs(snap.lastTs, now),
    };
  const reject = (reason) => ({ ...out, reason });
  if (ctx.inMatch === false) return reject("fora-de-partida");
  if (g.endedAt) return reject("partida-encerrada");
  if (ctx.set != null && g.set != null && Number(g.set) !== Number(ctx.set))
    return reject("set-diferente");
  if (out.gameId && ctx.gameId != null && String(ctx.gameId) !== out.gameId)
    return reject("outra-partida");
  if (out.lastEventAgeMs === null || out.lastEventAgeMs > staleMs)
    return { ...out, state: "obsoleto", reason: "sem-eventos-recentes" };
  const s = snap.state,
    field = (f, value) => (f ? { value, ageMs: ageMs(f.ts, now) } : null);
  // O banco de itens só vale com a identidade local confirmada; se o servidor sabe quem é o jogador e o roster diz outro, não.
  const identityOk =
    !!s.identity &&
    (!ctx.local?.name ||
      (same(ctx.local.name, s.identity.name) &&
        (!ctx.local.tag || same(ctx.local.tag, s.identity.tag))));
  const fields = {
    gold: s.gold
      ? {
          ...field(s.gold, s.gold.value),
          ...(s.gold.inferredZero ? { inferredZero: true } : {}),
        }
      : null,
    level: field(s.level, s.level?.value),
    xp: field(s.xp, s.xp?.value),
    stage: s.stage
      ? { ...field(s.stage, s.stage.value), name: s.stage.name }
      : null,
    shop: s.shop
      ? { ...field(s.shop, s.shop.value), visible: s.shopVisible }
      : null,
    bench: s.bench
      ? { ...field(s.bench, s.bench.value), unknown: s.bench.unknown }
      : null,
    items:
      s.items && identityOk
        ? {
            ...field(s.items, s.items.value),
            bank: s.items.bank,
            removers: s.items.removers,
            unknown: s.items.unknown,
          }
        : null,
  };
  return {
    ...out,
    state: "ativo",
    available: true,
    identity: s.identity
      ? identityOk
        ? "confirmada"
        : "divergente"
      : "desconhecida",
    fields,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Leitor incremental do SQLite (síncrono, curto, sem estado aberto entre leituras).

function loadSqlite() {
  try {
    const mod =
      process.getBuiltinModule?.("node:sqlite") ??
      createRequire(import.meta.url)("node:sqlite");
    return mod?.DatabaseSync ? mod : null;
  } catch {
    return null;
  }
}

/** Classifica um erro do SQLite: transitório (travado) mantém o que já foi lido; os demais derrubam a fonte. */
function classify(e) {
  const code = e?.errcode ?? null,
    msg = String(e?.message ?? e);
  if (e?.code === "ENOENT")
    return { state: "ausente", reason: "banco-ausente" };
  if (code === 5 || code === 6 || /locked|busy/i.test(msg))
    return {
      transient: true,
      state: "ausente",
      reason: "banco-travado",
      detail: msg,
    };
  if (code === 11 || code === 26 || /malformed|not a database/i.test(msg))
    return {
      state: "esquema-desconhecido",
      reason: "arquivo-invalido",
      detail: msg,
    };
  if (code === 14 || /unable to open/i.test(msg))
    return { state: "ausente", reason: "banco-inacessivel", detail: msg };
  return { state: "ausente", reason: "erro-de-leitura", detail: msg };
}

function columns(db, table) {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name),
  );
}

/**
 * Cria o leitor. `status(ctx)` lê o banco no máximo a cada `minIntervalMs` (a leitura é síncrona, de milissegundos, com
 * `busy_timeout` curto) e avalia o frescor a cada chamada. Nunca lança.
 * Opções: `file`, `now`, `staleMs`, `minIntervalMs`, `champions`/`items` (conjuntos de ids do catálogo; sem eles aceita tudo).
 */
export function gepReader({
  file = defaultGepDb(),
  now = Date.now,
  staleMs = Number(process.env.TFT_GEP_STALE_MS) > 0
    ? Number(process.env.TFT_GEP_STALE_MS)
    : GEP_STALE_MS,
  minIntervalMs = MIN_INTERVAL_MS,
  champions = null,
  items = null,
} = {}) {
  const env = {
    isChampion: champions ? (id) => champions.has(id) : () => true,
    isItem: items ? (id) => items.has(id) : () => true,
  };
  const sqlite = loadSqlite();
  let readAt = -Infinity,
    gameKey = null,
    state = emptyGepState(),
    game = null,
    lastTs = null,
    maxId = 0,
    catchingUp = false,
    error = null,
    retryAt = 0;

  function open() {
    // Com -wal/-shm presentes alguém pode estar gravando: leitura normal (enxerga o WAL). Sem eles, ninguém tem o banco
    // aberto: `immutable=1` não cria arquivos novos na pasta do TFTAcademy.
    const shared = fs.existsSync(`${file}-wal`) || fs.existsSync(`${file}-shm`);
    return shared
      ? new sqlite.DatabaseSync(file, {
          readOnly: true,
          timeout: BUSY_TIMEOUT_MS,
        })
      : new sqlite.DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, {
          timeout: BUSY_TIMEOUT_MS,
        });
  }

  function readOnce() {
    if (!sqlite)
      return {
        state: "ausente",
        reason: "sqlite-indisponivel",
        detail: "node:sqlite não existe nesta versão do Node",
      };
    if (!fs.existsSync(file))
      return { state: "ausente", reason: "banco-ausente" };
    const db = open();
    try {
      for (const [table, needed] of Object.entries(REQUIRED)) {
        const have = columns(db, table),
          missing = needed.filter((c) => !have.has(c));
        if (!have.size || missing.length)
          return {
            state: "esquema-desconhecido",
            reason: have.size ? "colunas-ausentes" : "tabela-ausente",
            detail: `${table}: ${missing.join(", ") || "sem colunas"}`,
          };
      }
      const gcols = columns(db, "games"),
        ecols = columns(db, "events"),
        pick = (c) => (gcols.has(c) ? c : "NULL");
      const latest = db
        .prepare(
          `SELECT id, started_at AS startedAt, ${pick("ended_at")} AS endedAt, ${pick("match_id")} AS matchId, ${pick("set_number")} AS "set"
           FROM games ORDER BY started_at DESC, rowid DESC LIMIT 1`,
        )
        .get();
      if (!latest) return { state: "ausente", reason: "sem-partida" };
      const beat = db
        .prepare(
          "SELECT MAX(id) AS id, MAX(timestamp) AS ts FROM events WHERE game_id = ?",
        )
        .get(latest.id);
      if (latest.id !== gameKey || (beat.id ?? 0) < maxId) {
        // Partida nova (ou banco regravado): recomeça do zero.
        gameKey = latest.id;
        state = emptyGepState();
        maxId = 0;
      }
      const featureCol = ecols.has("feature") ? "feature" : "NULL AS feature";
      const marks = KEY_NAMES.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT id, timestamp AS ts, ${featureCol}, key, data FROM events
           WHERE game_id = ? AND id > ? AND key IN (${marks}) ORDER BY id LIMIT ${BATCH}`,
        )
        .all(latest.id, state.lastId, ...KEY_NAMES);
      for (const row of rows) applyGepEvent(state, row, env);
      // Passou do lote: o resto vem na próxima leitura (o marcador só avança até onde foi lido).
      catchingUp = rows.length === BATCH;
      if (!catchingUp) state.lastId = Math.max(state.lastId, beat.id ?? 0);
      maxId = Math.max(maxId, state.lastId);
      game = latest;
      lastTs = beat.ts ?? null;
      return null;
    } finally {
      db.close();
    }
  }

  function refresh() {
    readAt = now();
    if (now() < retryAt) return;
    try {
      const failure = readOnce();
      error = failure;
      retryAt = failure && !failure.transient ? now() + ERROR_BACKOFF_MS : 0;
      if (failure && !failure.transient) {
        game = null;
        gameKey = null;
        state = emptyGepState();
        maxId = 0;
      }
    } catch (e) {
      error = classify(e);
      retryAt = now() + (error.transient ? 1000 : ERROR_BACKOFF_MS);
    }
  }

  return {
    /** Lê (se já passou o intervalo) e avalia a fonte para a partida `ctx`. */
    status(ctx = {}) {
      if (now() - readAt >= minIntervalMs) refresh();
      // Travado de passagem: usa o que já foi lido (o frescor cuida de envelhecer); os demais erros não têm dados.
      const snap =
        error && !(error.transient && game)
          ? { error }
          : { game, state, lastTs, catchingUp };
      const result = evaluateGep(
        game || error ? snap : null,
        ctx,
        now(),
        staleMs,
      );
      return error?.transient && game
        ? { ...result, warning: error.reason }
        : result;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Integração com o estado lido pelo servidor.

/** Resumo para `/api/state` (`gepStatus`): sem os valores, só o estado da fonte. */
export function gepSummary(gep) {
  if (!gep) return { state: "ausente", reason: "desligada", available: false };
  const { fields: _fields, ...rest } = gep;
  return rest;
}

/**
 * Precedência por campo: GEP fresco > leitor de tela > estimativa. `seen` é o estado já mesclado (tela + arquivos do
 * jogo + nível validado). Com a fonte ativa troca ouro, nível, XP, banco de itens e loja pelos do GEP; o estágio do
 * arquivo do jogo continua valendo (GEP só preenche se faltar). Sem GEP fresco devolve `seen` com `gepStatus` apenas.
 * `sources.<campo>` = origem ("gep", "screen", "game-log", "derived", "manual"|null); `sourcesDetail.<campo>` traz
 * `{source, ageMs, confidence}`. `gepBench` (reserva do GEP) só existe com a fonte ativa; o servidor o usa no motor.
 */
export function mergeGep(seen, gep) {
  const gepStatus = gepSummary(gep);
  if (!gep?.available) return { ...seen, gepStatus };
  const f = gep.fields,
    out = { ...seen, gepStatus },
    sources = { ...seen.sources },
    detail = {},
    stale = { ...seen.stale },
    take = (name, field, apply) => {
      if (!field || field.value === null || field.value === undefined) return;
      apply(field.value);
      sources[name] = "gep";
      detail[name] = {
        source: "gep",
        ageMs: field.ageMs,
        confidence: "observed",
        ...(field.inferredZero ? { inferred: true } : {}),
      };
    };
  take("gold", f.gold, (v) => {
    out.gold = v;
    stale.gold = false;
  });
  take("level", f.level, (v) => {
    out.level = v;
    out.levelSource = "gep";
    out.levelConflict = false;
    out.levelAmbiguous = false;
    out.levelInfo = {
      source: "gep",
      minimum: false,
      stale: false,
      rejected: null,
      conflict: false,
      ambiguous: false,
      read: v,
    };
    stale.level = false;
  });
  take("xp", f.xp, (v) => {
    out.xp = v;
    stale.xp = false;
  });
  // Sem XP no GEP (nível máximo): a barra antiga da tela seria de outro momento.
  if (f.level && !f.xp && out.xp != null) {
    out.xp = null;
    sources.xp = null;
  }
  if (seen.sources?.stage !== "game-log")
    take("stage", f.stage, (v) => {
      out.stage = v;
    });
  // Loja escondida (shop_visible false) não sobrescreve: o que a tela vê continua valendo.
  if (f.shop && f.shop.visible !== false)
    take("shop", f.shop, (v) => {
      out.shop = v;
    });
  take("items", f.items, (v) => {
    out.items = v;
    out.bank = f.items.bank;
    out.unknownItems = f.items.unknown;
    out.removers = f.items.removers;
  });
  if (f.bench)
    take("bench", f.bench, (v) => {
      out.gepBench = v;
    });
  else sources.bench = seen.sources?.bench ?? "manual";
  return {
    ...out,
    stale,
    sources,
    sourcesDetail: { ...seen.sourcesDetail, ...detail },
  };
}

/** Peças da reserva do GEP no formato que o motor lê em `options.bench` (só do jogador local). */
export function gepBenchUnits(seen, playerId) {
  return (seen?.gepBench ?? [])
    .filter((u) => u.id && u.stars !== null)
    .map((u) => ({
      playerId,
      championName: u.id,
      starLevel: u.stars,
      itemNames: u.items,
      source: "gep",
    }));
}
