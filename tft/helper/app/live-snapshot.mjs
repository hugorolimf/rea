// Último Ao vivo de cada partida, congelado quando ela encerra: o corpo de GET /api/state e o de POST /api/recommend que
// alimentam v2/js/model.js no último momento em que a partida estava em andamento. A interface os rele em
// `#revisao/<id>` e desenha exatamente a mesma tela, sem pedir análise nova.
//
// Formato em disco: `<dir>/<gameId>.json.gz`, JSON comprimido `{ v, gameId, at, state, recommendation }`. `v` é a versão do
// esquema (`SCHEMA`); versão desconhecida, arquivo ausente ou corrompido leem como "sem dados guardados" (null). O registro
// da partida no histórico (match-history.jsonl) leva só `liveSnapshot: { v, at, bytes }`; registros antigos não o têm.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/** Versão do esquema do arquivo guardado. */
export const SCHEMA = 1;
/** Quantas partidas ficam guardadas; as mais antigas saem quando entra uma nova (cada uma pesa algumas centenas de KB). */
export const KEEP = 40;

const FILE = /^(\d+)\.json\.gz$/;

/**
 * Cria o guardião. `dir` é a pasta dos arquivos (criada na primeira gravação); `keep` o limite de partidas; `now` o relógio.
 * Nada é lido nem escrito até alguém chamar `freeze`/`read`; a lista de partidas já guardadas vem da pasta, ao criar.
 */
export function createLiveSnapshots({ dir, keep = KEEP, now = Date.now } = {}) {
  /** @type {Map<string, {at: string, bytes: number | null, payload?: object}>} */
  const index = new Map();
  try {
    for (const name of fs.readdirSync(dir)) {
      const id = FILE.exec(name)?.[1];
      if (!id) continue;
      const stat = fs.statSync(path.join(dir, name));
      index.set(id, { at: stat.mtime.toISOString(), bytes: stat.size });
    }
  } catch {
    // Pasta ainda inexistente: nada guardado.
  }
  const fileOf = (id) => path.join(dir, `${id}.json.gz`);
  const infoOf = (entry) => ({
    v: SCHEMA,
    at: entry.at,
    ...(entry.bytes != null ? { bytes: entry.bytes } : {}),
  });

  /** Remove as partidas mais antigas além do limite. */
  function prune() {
    const old = [...index.entries()]
      .sort((a, b) => Date.parse(a[1].at) - Date.parse(b[1].at))
      .slice(0, Math.max(0, index.size - keep));
    for (const [id] of old) {
      index.delete(id);
      fs.promises.rm(fileOf(id), { force: true }).catch(() => {});
    }
  }

  return {
    /**
     * Congela o último Ao vivo da partida `gameId` a partir de `frame` (`overlay.liveFrame()`: o último estado e a última
     * recomendação gravados com a partida em andamento). Devolve `{ v, at, bytes? }` ou null se o quadro não é desta partida
     * (sem estado, sem recomendação ou de outra partida): nada é guardado nesse caso. Regravar a mesma partida a substitui.
     */
    freeze(gameId, frame) {
      const id = String(gameId ?? ""),
        state = frame?.state?.body,
        rec = frame?.recommendation?.body;
      if (!FILE.test(`${id}.json.gz`) || !state || !rec) return null;
      const stateId = state.match?.id ?? state.gameId;
      if (String(stateId) !== id) return null;
      const recId = rec.metadata?.gameId;
      if (recId != null && String(recId) !== id) return null;
      const at = new Date(frame.state.at ?? now()).toISOString(),
        payload = { v: SCHEMA, gameId: id, at, state, recommendation: rec },
        entry = { at, bytes: null, payload };
      index.set(id, entry);
      // Comprime e grava fora do caminho da leitura; até terminar, `read` devolve o objeto em memória.
      zlib.gzip(JSON.stringify(payload), (error, gz) => {
        if (error || index.get(id) !== entry) return;
        fs.promises
          .mkdir(dir, { recursive: true })
          .then(async () => {
            const tmp = `${fileOf(id)}.${process.pid}.tmp`;
            await fs.promises.writeFile(tmp, gz);
            await fs.promises.rename(tmp, fileOf(id));
            if (index.get(id) === entry) {
              entry.bytes = gz.length;
              delete entry.payload;
            }
            prune();
          })
          .catch(() => {
            // Disco indisponível: o Ao vivo congelado fica só em memória até o servidor reiniciar.
          });
      });
      return infoOf(entry);
    },
    /** O que está guardado da partida (`{ v, at, bytes? }`), ou null. */
    info(gameId) {
      const entry = index.get(String(gameId));
      return entry ? infoOf(entry) : null;
    },
    /**
     * O Ao vivo guardado da partida (`{ v, gameId, at, state, recommendation }`) ou null: não existe, é de uma versão de
     * esquema que esta versão não entende ou o arquivo está corrompido.
     */
    read(gameId) {
      const id = String(gameId),
        entry = index.get(id);
      if (!entry) return null;
      if (entry.payload) return entry.payload;
      try {
        const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(fileOf(id))));
        return data?.v === SCHEMA && data.state && data.recommendation
          ? data
          : null;
      } catch {
        return null;
      }
    },
  };
}
