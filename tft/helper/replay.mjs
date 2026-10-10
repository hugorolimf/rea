// Rever uma partida passada: reconstrói o snapshot final a partir das capturas de tabuleiro que o servidor
// grava a cada mudança (data/scouting-captures.jsonl; uma linha por jogador e mudança). O último registro
// de cada jogador é o tabuleiro e a vida finais observados. Banco, loja, ouro e XP não fazem parte da captura.
import fsp from "node:fs/promises";

// O arquivo só cresce (capture.mjs anexa a cada mudança de tabuleiro): guarda o offset já lido e o resto de
// linha incompleta para ler apenas os bytes novos, em vez de reparsear todas as partidas a cada recomendação.
const emptyCache = () => ({
  file: null,
  id: null,
  size: 0,
  mtimeMs: 0,
  tail: Buffer.alloc(0),
  games: new Map(),
});
let cache = emptyCache(),
  queue = Promise.resolve();

/** Acrescenta uma linha ao Map de partidas; devolve false se ela não é JSON válido. */
function ingest(games, line) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return false; // linha truncada não invalida o restante
  }
  if (row?.gameId == null || row.id == null) return true;
  const game = games.get(String(row.gameId)) ?? { last: new Map(), rows: [] };
  game.last.set(String(row.id), row);
  game.rows.push(row);
  games.set(String(row.gameId), game);
  return true;
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
      if (line) ingest(cache.games, line);
  let tail = Buffer.from(data.subarray(end + 1));
  // Última linha sem \n: um objeto JSON que já parseia está completo (nenhum prefixo de objeto é JSON válido).
  if (
    tail.length &&
    tail.toString("utf8").trimStart().startsWith("{") &&
    ingest(cache.games, tail.toString("utf8"))
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
 * Lê as capturas agrupando por partida: Map gameId → {last: Map playerId → último registro, rows: todos na
 * ordem gravada}. Incremental e serializado (duas leituras simultâneas não duplicam as mesmas linhas).
 */
function load(file) {
  const run = queue.then(() => refresh(file));
  queue = run.catch(() => {});
  return run;
}

/**
 * Snapshot no formato do arquivo do jogo para a partida `gameId`, ou null se ela não foi capturada.
 * `record` (do histórico) completa fila e colocação do Hero.
 */
export async function replaySnapshot(
  file,
  gameId,
  { heroId, set, record = null } = {},
) {
  const players = (await load(file)).get(String(gameId))?.last;
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
    return (await load(file)).get(String(gameId))?.rows.slice() ?? [];
  } catch {
    return [];
  }
}
