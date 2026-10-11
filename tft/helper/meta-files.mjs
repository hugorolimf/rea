// Primitivas de disco e de rede das cópias de meta (meta-*.mjs, augment-stats.mjs e meta-store.mjs).
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);

/** Renomeia por cima do destino; no Windows um leitor concorrente pode segurar o arquivo por instantes. */
async function renameReplace(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (e) {
      if (attempt >= 5 || !BUSY.has(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
}

/**
 * Grava `text` em `file` de forma atômica (arquivo temporário vizinho + rename): quem lê vê a cópia antiga inteira ou a
 * nova inteira, nunca um arquivo pela metade, mesmo que o processo morra no meio. Cria a pasta se preciso.
 */
export async function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, text);
    await renameReplace(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** Sinal de cancelamento de uma requisição: o tempo próprio dela, somado ao do chamador (sincronização com teto). */
export const netSignal = (ms, outer) =>
  outer
    ? AbortSignal.any([AbortSignal.timeout(ms), outer])
    : AbortSignal.timeout(ms);
