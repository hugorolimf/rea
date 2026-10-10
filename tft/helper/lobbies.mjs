// Tabuleiros finais de todos os jogadores com a colocação oficial: o dado que mede se o modelo de tabuleiro
// acerta nas suas partidas (colocação esperada × colocação real). O arquivo do jogo dá a colocação (ffaStanding) de quem foi
// eliminado (vida ≤ 0) e, quando só resta um vivo, a do vencedor. Uma linha por jogador e partida.
// O primeiro arquivo de cada partida vem com vida e colocação -1 em todos: não é eliminação.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Cria o registro; `observe(snapshot)` é idempotente e pode ser chamado a cada leitura do arquivo do jogo. */
export function lobbyRecorder(file) {
  const seen = new Set();
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        seen.add(`${r.gameId}|${r.playerId}`);
      } catch {}
    }
  } catch {}
  return {
    observe(snapshot) {
      const players = snapshot?.statsBlock?.players ?? [],
        alive = players.filter((p) => p.health > 0);
      const rows = [];
      for (const p of players) {
        const done =
          p.ffaStanding >= 1 &&
          (p.health <= 0 || (alive.length === 1 && alive[0] === p));
        const k = `${snapshot.gameId}|${p.playerId}`;
        if (!done || seen.has(k)) continue;
        seen.add(k);
        rows.push({
          gameId: snapshot.gameId,
          playerId: String(p.playerId),
          name: p.riotIdGameName ?? p.summonerName ?? null,
          placement: alive.length === 1 && alive[0] === p ? 1 : p.ffaStanding,
          seconds: snapshot.statsBlock.gameLengthSeconds ?? null,
          units: (p.boardPieces ?? []).map((u) => ({
            id: u.championName,
            stars: u.starLevel,
            items: u.itemNames ?? [],
          })),
        });
      }
      if (!rows.length) return;
      fsp
        .mkdir(path.dirname(file), { recursive: true })
        .then(() =>
          fsp.appendFile(
            file,
            rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
          ),
        )
        .catch((e) => {
          // Libera as chaves: o próximo snapshot grava essas linhas de novo.
          for (const r of rows) seen.delete(`${r.gameId}|${r.playerId}`);
          console.log("Tabuleiros finais não gravados: " + e.message);
        });
    },
  };
}
