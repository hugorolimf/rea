// Rever uma partida passada: reconstrói o snapshot final a partir das capturas de tabuleiro que o servidor
// grava a cada mudança (data/scouting-captures.jsonl; uma linha por jogador e mudança). O último registro
// de cada jogador é o tabuleiro e a vida finais observados. Banco, loja, ouro e XP não fazem parte da captura.
import fsp from "node:fs/promises";

// O arquivo só cresce (capture.mjs anexa a cada mudança de tabuleiro): guarda o offset já lido e o resto de
// linha incompleta para ler apenas os bytes novos, em vez de reparsear todas as partidas a cada recomendação.
//
// Memória: só a partida corrente (a da última linha lida) fica em `games`. Ao começar outra partida a anterior sai
// do Map e vai para `evicted` (o arquivo em disco continua inteiro); as linhas tardias de uma partida já descartada
// são ignoradas para ela nunca ficar parcial. Quem pede uma partida descartada (rever partida passada) a relê do
// arquivo (`scanGame`) e ela fica na vaga `pinned` até pedirem outra. Antes todas as partidas ficavam para sempre
// (~700 linhas cada; 18,7 MB de heap com 33 partidas).
const emptyCache = () => ({
  file: null,
  id: null,
  size: 0,
  mtimeMs: 0,
  tail: Buffer.alloc(0),
  games: new Map(),
  current: null,
  evicted: new Set(),
  pinned: null,
});
let cache = emptyCache(),
  queue = Promise.resolve();

/** Acrescenta uma linha à partida corrente do cache; devolve false se ela não é JSON válido. */
function ingest(state, line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return false; // linha truncada não invalida o restante
  }
  if (row?.gameId == null || row.id == null) return true;
  const gameId = String(row.gameId);
  if (state.evicted.has(gameId)) return true;
  if (gameId !== state.current) {
    if (state.current !== null) {
      state.games.delete(state.current);
      state.evicted.add(state.current);
    }
    state.current = gameId;
  }
  const game = state.games.get(gameId) ?? { last: new Map(), rows: [] };
  game.last.set(String(row.id), row);
  game.rows.push(row);
  state.games.set(gameId, game);
  return true;
}

/** Relê o arquivo inteiro só para a partida `gameId` (ordem gravada); não toca no cache incremental. */
async function scanGame(file, gameId) {
  const game = { last: new Map(), rows: [] };
  for (const line of (await fsp.readFile(file, "utf8")).split("\n")) {
    if (!line.includes(gameId)) continue; // filtro barato antes do parse
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (String(row?.gameId) !== gameId || row.id == null) continue;
    game.last.set(String(row.id), row);
    game.rows.push(row);
  }
  return game;
}

/** Lê o arquivo do offset em cache até `stat.size`, ou do zero se ele foi trocado, truncado ou regravado. */
async function refresh(file) {
  const stat = await fsp.stat(file);
  const id = `${stat.dev}:${stat.ino}`,
    same = cache.file === file && cache.id === id;
  if (same && stat.size === cache.size && stat.mtimeMs === cache.mtimeMs)
    return cache.games;
  if (!same || stat.size <= cache.size) cache = { ...emptyCache(), file, id };
  const length = stat.size - cache.size,
    buf = Buffer.alloc(length);
  let read = 0;
  const handle = await fsp.open(file, "r");
  try {
    while (read < length) {
      const { bytesRead } = await handle.read(
        buf,
        read,
        length - read,
        cache.size + read,
      );
      if (!bytesRead) break;
      read += bytesRead;
    }
  } finally {
    await handle.close();
  }
  // Decodifica só até o último \n: um caractere UTF-8 cortado na fronteira fica no resto pendente.
  const data = Buffer.concat([cache.tail, buf.subarray(0, read)]),
    end = data.lastIndexOf(0x0a);
  if (end >= 0)
    for (const line of data.toString("utf8", 0, end).split("\n"))
      if (line) ingest(cache, line);
  let tail = Buffer.from(data.subarray(end + 1));
  // Última linha sem \n: um objeto JSON que já parseia está completo (nenhum prefixo de objeto é JSON válido).
  if (
    tail.length &&
    tail.toString("utf8").trimStart().startsWith("{") &&
    ingest(cache, tail.toString("utf8"))
  )
    tail = Buffer.alloc(0);
  Object.assign(cache, {
    size: cache.size + read,
    mtimeMs: read === length ? stat.mtimeMs : 0,
    tail,
  });
  return cache.games;
}

/**
 * Lê as capturas da partida `gameId`: {last: Map playerId → último registro, rows: todos na ordem gravada}, ou
 * undefined se ela não está no arquivo. Incremental e serializado (duas leituras simultâneas não duplicam as mesmas
 * linhas). A partida corrente sai do cache incremental; uma já descartada vem de `scanGame` (vaga `pinned`).
 */
function load(file, gameId) {
  const run = queue.then(async () => {
    const id = String(gameId),
      hit = (await refresh(file)).get(id);
    if (hit || !cache.evicted.has(id)) return hit;
    if (cache.pinned?.gameId !== id)
      cache.pinned = { gameId: id, game: await scanGame(file, id) };
    return cache.pinned.game;
  });
  queue = run.catch(() => {});
  return run;
}

/** Quantas partidas o cache guarda em memória, quantas já foram descartadas e a vaga fixada (para teste e log). */
export const replayCacheStats = () => ({
  games: cache.games.size,
  evicted: cache.evicted.size,
  pinned: cache.pinned?.gameId ?? null,
});

/**
 * Snapshot no formato do arquivo do jogo para a partida `gameId`, ou null se ela não foi capturada.
 * `record` (do histórico) completa fila e colocação do Hero.
 */
export async function replaySnapshot(
  file,
  gameId,
  { heroId, set, record = null } = {},
) {
  const players = (await load(file, gameId))?.last;
  if (!players?.size) return null;
  const rows = [...players.values()],
    endedAt = rows.reduce((t, r) => (r.sourceAt > t ? r.sourceAt : t), "");
  return {
    endedAt,
    snapshot: {
      gameId: Number(gameId),
      queueType: record?.queue ?? null,
      statsBlock: {
        setCoreName: set,
        gameLengthSeconds: record?.durationSeconds ?? null,
        players: rows.map((r) => ({
          playerId: r.id,
          riotIdGameName: r.name,
          health: r.health,
          ffaStanding:
            String(r.id) === String(heroId)
              ? (record?.placement ?? null)
              : null,
          boardPieces: (r.units ?? []).map((u) => ({
            championName: u.championName,
            starLevel: u.starLevel,
            itemNames: u.itemNames ?? [],
            price: u.price,
          })),
        })),
      },
    },
  };
}

/** Todas as capturas da partida `gameId`, na ordem gravada (vazio se não houver arquivo ou partida). */
export async function gameRows(file, gameId) {
  try {
    // Cópia: o array em cache continua crescendo nas próximas leituras incrementais.
    return (await load(file, gameId))?.rows.slice() ?? [];
  } catch {
    return [];
  }
}
