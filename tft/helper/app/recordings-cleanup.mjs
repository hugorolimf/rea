// Limpeza das gravações de vídeo do TFTAcademy (pedido do usuário, 2026-10-12): a pasta passa de 14 GB e o usuário quer
// só as 2 mais recentes — a da partida atual (em gravação) e a da última. O servidor varre a pasta ao subir e a cada
// minuto e apaga as mais antigas.
//
// Só toca em arquivos com o nome que o TFTAcademy dá às gravações ("<id do jogo>-AAAA-MM-DD-HH-MM-SS.<ext>", observado no
// log dele: `tft-recordings\d1afb2b1-…-2026-10-12-00-22-24.mp4`); qualquer outro arquivo da pasta fica. Arquivos com o
// mesmo id de jogo são uma gravação só (o vídeo e o que vier junto dele). A ordem é a data de início no nome, então a
// gravação em andamento é sempre a primeira das que ficam. `TFT_RECORDINGS_CLEANUP=0` desliga; `TFT_RECORDINGS_DIR`
// troca a pasta (padrão: `%APPDATA%\TFTAcademy\tft-recordings`, o `recording_location` do TFTAcademy).
import fs from "node:fs/promises";
import path from "node:path";

/** Gravações que ficam: a da partida atual e a da última. */
export const KEEP_RECORDINGS = 2;
/** Intervalo entre as varreduras da pasta. */
export const CLEANUP_INTERVAL_MS = 60_000;

/** Nome de uma gravação do TFTAcademy: id do jogo (uuid), data e hora do início e a extensão. */
const NAME =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.[^.\\/]+$/i;

/** Pasta das gravações: `TFT_RECORDINGS_DIR` ou a padrão do TFTAcademy; null sem `APPDATA` (fora do Windows). */
export const recordingsDir = (env = process.env) =>
  env.TFT_RECORDINGS_DIR ||
  (env.APPDATA ? path.join(env.APPDATA, "TFTAcademy", "tft-recordings") : null);

/**
 * Arquivos a apagar, sem I/O. `files`: `[{ name, mtimeMs, size }]` da pasta. Agrupa por gravação (id do jogo), ordena da
 * mais recente para a mais antiga pela data de início no nome (empate: a última modificação) e devolve os arquivos das
 * gravações além de `keep`. Arquivo com outro nome nunca entra.
 */
export function recordingsToDelete(files, keep = KEEP_RECORDINGS) {
  const groups = new Map();
  for (const f of files ?? []) {
    const m = NAME.exec(f?.name ?? "");
    if (!m) continue;
    const g = groups.get(m[1]) ?? { stamp: m[2], mtimeMs: 0, files: [] };
    if (m[2] > g.stamp) g.stamp = m[2];
    g.mtimeMs = Math.max(g.mtimeMs, f.mtimeMs ?? 0);
    g.files.push(f);
    groups.set(m[1], g);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0) ||
        b.mtimeMs - a.mtimeMs,
    )
    .slice(Math.max(0, keep))
    .flatMap((g) => g.files);
}

/**
 * Varredura periódica. `log(nível, texto)` recebe o que foi apagado ("INFO") e o que não deu para apagar ("AVISO", só
 * quando a lista de falhas muda, para não repetir a cada minuto). Devolve `{ sweep, start, stop }`; `sweep()` resolve com
 * `{ removed, bytes, failed }` (null sem a pasta ou com outra varredura em andamento).
 */
export function recordingsCleanup({
  dir = recordingsDir(),
  keep = KEEP_RECORDINGS,
  intervalMs = CLEANUP_INTERVAL_MS,
  log = () => {},
  fsp = fs,
} = {}) {
  let timer = null,
    running = false,
    lastFailed = "";
  async function sweep() {
    if (!dir || running) return null;
    running = true;
    try {
      let names;
      try {
        names = await fsp.readdir(dir);
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
      const files = [];
      for (const name of names) {
        if (!NAME.test(name)) continue;
        try {
          const st = await fsp.stat(path.join(dir, name));
          if (st.isFile())
            files.push({ name, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // Sumiu entre a listagem e o stat (o próprio TFTAcademy apagou): nada a fazer.
        }
      }
      let removed = 0,
        bytes = 0;
      const failed = [];
      for (const f of recordingsToDelete(files, keep)) {
        try {
          await fsp.unlink(path.join(dir, f.name));
          removed++;
          bytes += f.size ?? 0;
        } catch (e) {
          if (e.code !== "ENOENT")
            failed.push(`${f.name} (${e.code ?? e.message})`);
        }
      }
      if (removed)
        log(
          "INFO",
          `gravações do TFTAcademy: ${removed} ${removed === 1 ? "arquivo apagado" : "arquivos apagados"} (${(bytes / 1024 ** 3).toFixed(2)} GB); ficam as ${keep} mais recentes em ${dir}`,
        );
      const failedText = failed.join(", ");
      if (failedText && failedText !== lastFailed)
        log(
          "AVISO",
          `gravações do TFTAcademy: não deu para apagar ${failedText}; nova tentativa a cada ${Math.round(intervalMs / 1000)} s`,
        );
      lastFailed = failedText;
      return { removed, bytes, failed };
    } finally {
      running = false;
    }
  }
  const safe = () =>
    sweep().catch((e) =>
      log("AVISO", `gravações do TFTAcademy: varredura falhou (${e.message})`),
    );
  return {
    sweep,
    start() {
      if (timer || !dir) return;
      void safe();
      timer = setInterval(() => void safe(), intervalMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
