// Cliente local do LoL (LCU): partida, jogador e fase do cliente, lidos pela API HTTPS local que o próprio cliente expõe.
// Só leitura e só transporte: o servidor guarda o cache e decide quando perguntar de novo.
import fs from "node:fs/promises";
import https from "node:https";

const LOCKFILE = "C:/Riot Games/League of Legends/lockfile";
const TIMEOUT_MS = 2000;

/** GET numa rota do LCU; null em qualquer falha (cliente fechado, timeout, corpo que não é JSON). */
function getter(port, password) {
  return (route) =>
    new Promise((resolve) => {
      const r = https.request(
        {
          hostname: "127.0.0.1",
          port,
          path: route,
          rejectUnauthorized: false,
          headers: {
            Authorization:
              "Basic " + Buffer.from("riot:" + password).toString("base64"),
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
      r.setTimeout(TIMEOUT_MS, () => r.destroy(Error("timeout")));
      r.end();
    });
}

/**
 * Lê `{ gameId, puuid, phase, at }` do cliente; null sem cliente (lockfile ausente ou ilegível). `at` identifica a leitura:
 * o rastreador conta leituras do cliente, não chamadas.
 */
export async function readLcuData() {
  try {
    const parts = (await fs.readFile(LOCKFILE, "utf8")).trim().split(":");
    const get = getter(parts[2], parts[3]);
    const [session, self, phase] = await Promise.all([
      get("/lol-gameflow/v1/session"),
      get("/lol-summoner/v1/current-summoner"),
      get("/lol-gameflow/v1/gameflow-phase"),
    ]);
    return {
      gameId: session?.gameData?.gameId,
      puuid: self?.puuid,
      phase,
      at: Date.now(),
    };
  } catch {
    return null;
  }
}
