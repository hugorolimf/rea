// Ciclo de vida da partida: detecta início e fim e grava um histórico enxuto (uma linha JSON por partida).
//
// Fontes, na ordem de confiança:
// - cliente (LCU): fase InProgress/Reconnect e gameId marcam o início assim que a partida carrega; sair dessas
//   fases encerra a partida;
// - tabuleiro (TFTEoGStats.json): ffaStanding é a colocação corrente. Hero com vida ≤ 0 tem colocação definitiva;
//   Hero como único vivo venceu. O primeiro arquivo de cada partida vem com vida e colocação -1 em todos e não
//   significa eliminação.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const IN_GAME = new Set(["InProgress", "Reconnect"]);
// Encerrada pelo cliente sem colocação: espera o jogo gravar o tabuleiro final antes de registrar sem ela.
const FINAL_WAIT_MS = 3 * 60 * 1000;

function readHistory(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const r = JSON.parse(line);
          return r && r.gameId != null ? [r] : [];
        } catch {
          return []; // linha truncada não invalida o restante
        }
      });
  } catch {
    return [];
  }
}

/** Colocação definitiva do Hero neste snapshot, ou null enquanto a partida dele continua. */
export function finalPlacement(snapshot, heroId) {
  const players = snapshot?.statsBlock?.players ?? [],
    hero = players.find((p) => String(p.playerId) === heroId);
  if (!hero || !(hero.ffaStanding >= 1)) return null;
  if (hero.health <= 0) return hero.ffaStanding;
  return players.filter((p) => p.health > 0).length <= 1 ? 1 : null;
}

/**
 * Cria o rastreador. `observe(snapshot, stat, session)` é idempotente e pode ser chamado a cada leitura;
 * `onChange({kind})` avisa "start", "end" e "saved".
 */
export function matchTracker(file, heroId, { onChange = () => {} } = {}) {
  const records = readHistory(file),
    recorded = new Set(records.map((r) => String(r.gameId))),
    started = new Set(); // partidas já iniciadas neste processo: um snapshot antigo nunca volta a abrir uma delas
  let match = null,
    boardGameId = null;

  const heroOf = (snapshot) =>
    snapshot?.statsBlock?.players?.find((p) => String(p.playerId) === heroId);

  function save() {
    const m = match;
    if (!m || m.saved || !m.board || recorded.has(String(m.id))) return;
    m.saved = true;
    const record = {
      gameId: m.id,
      queue: m.queue,
      set: m.set,
      endedAt: m.board.at,
      durationSeconds: m.board.seconds,
      placement: m.placement,
      units: m.board.units,
    };
    records.push(record);
    recorded.add(String(m.id));
    fsp
      .mkdir(path.dirname(file), { recursive: true })
      .then(() => fsp.appendFile(file, JSON.stringify(record) + "\n"))
      .catch((e) =>
        console.log("Histórico de partidas não gravado: " + e.message),
      );
    onChange({ kind: "saved", record });
  }
  function begin(id) {
    if (match?.status === "ended") save();
    started.add(String(id));
    match = {
      id,
      status: "live",
      startedAt: new Date().toISOString(),
      endedAt: null,
      placement: null,
      queue: null,
      set: null,
      board: null,
      saved: false,
    };
    onChange({ kind: "start" });
  }
  function end() {
    match.status = "ended";
    match.endedAt = new Date().toISOString();
    onChange({ kind: "end" });
  }

  return {
    /** Atualiza o estado com a leitura atual; snapshot/stat/session podem ser null (fonte indisponível). */
    observe(snapshot, stat, session) {
      const phase = typeof session?.phase === "string" ? session.phase : null,
        clientGame =
          IN_GAME.has(phase) && session?.gameId ? session.gameId : null,
        id = snapshot?.gameId ?? null;
      boardGameId = id;
      if (clientGame && clientGame !== match?.id) begin(clientGame);
      else if (
        !clientGame &&
        id &&
        id !== match?.id &&
        !started.has(String(id)) &&
        !recorded.has(String(id)) &&
        heroOf(snapshot) &&
        // Com o cliente fora da partida, só um tabuleiro final abre (e já fecha) uma partida perdida.
        (!phase || finalPlacement(snapshot, heroId) !== null)
      )
        begin(id);
      if (match && id === match.id) {
        const hero = heroOf(snapshot);
        match.queue = snapshot.queueType ?? match.queue;
        match.set = snapshot.statsBlock.setCoreName ?? match.set;
        if (hero && hero.ffaStanding >= 1 && match.placement === null)
          match.board = {
            at: (stat?.mtime ?? new Date()).toISOString(),
            seconds: snapshot.statsBlock.gameLengthSeconds ?? null,
            units: (hero.boardPieces ?? []).map((u) => ({
              id: u.championName,
              stars: u.starLevel,
              items: u.itemNames ?? [],
            })),
          };
        const placement = finalPlacement(snapshot, heroId);
        if (placement !== null && match.placement === null) {
          match.placement = placement;
          if (match.status === "live") end();
          save();
        }
      }
      if (match?.status === "live" && phase && !clientGame) end();
      if (
        match?.status === "ended" &&
        !match.saved &&
        Date.now() - Date.parse(match.endedAt) > FINAL_WAIT_MS
      )
        save();
      return this.status();
    },
    /** Estado para a interface. `boardReady` diz se o tabuleiro lido já é desta partida. */
    status() {
      return {
        id: match?.id ?? null,
        status: match?.status ?? "none",
        startedAt: match?.startedAt ?? null,
        endedAt: match?.endedAt ?? null,
        placement: match?.placement ?? null,
        boardReady: !!match && boardGameId === match.id,
        last: records.at(-1) ?? null,
        recorded: records.length,
      };
    },
    /** Partidas registradas, da mais recente para a mais antiga. */
    history(limit = 200) {
      return records.slice(-limit).reverse();
    },
  };
}
