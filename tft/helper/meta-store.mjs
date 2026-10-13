// Extensão MetaTFT offline: um módulo só para os quatro conjuntos de meta (comps, builds, estatísticas de tabuleiro e
// aprimoramentos). O assistente funciona sem rede desde a primeira execução; a rede só renova.
//
// Camadas de leitura, da mais nova para a mais antiga (vale a de `fetchedAt` mais recente que passar na validação):
//   1. snapshots do usuário em `<dir>/<conjunto>/<set>__<patch>.json` (e a cópia anterior `.prev.json` de cada patch);
//   2. o snapshot embarcado no repositório (`meta-*.json` ao lado deste módulo), que nunca é reescrito em execução.
// Uma cópia corrompida, de outro set ou fora do esquema é ignorada (e fica registrada em `problems`); a leitura cai na
// seguinte. Toda gravação é atômica e só acontece depois de a cópia baixada passar na mesma validação, então uma
// resposta ruim da MetaTFT nunca substitui uma cópia boa. Cada patch tem o seu arquivo; os 3 patches mais recentes ficam.
import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./meta-files.mjs";
import { compsAreStale, refreshComps, shapeComps } from "./meta-comps.mjs";
import {
  metaIsStale,
  refreshMeta,
  shape as shapeBuilds,
} from "./meta-builds.mjs";
import { refreshStats, statsAreStale } from "./meta-stats.mjs";
import { OUT_OF_SET, setIdsOf, statsSetProblem } from "./meta-scope.mjs";
import { augmentStatsAreStale, refreshAugmentStats } from "./augment-stats.mjs";

const KEEP_PATCHES = 3;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = Number.isFinite;
const strings = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
// [média, partidas] ou [média, partidas, vitória %] (meta-stats.mjs: a vitória entrou depois; cópias antigas têm dois).
const stat = (v) =>
  Array.isArray(v) &&
  (v.length === 2 || (v.length === 3 && finite(v[2]))) &&
  finite(v[0]) &&
  finite(v[1]);
const statMap = (v) => isObj(v) && Object.values(v).every(stat);

function validateComps(f) {
  if (!Array.isArray(f.comps) || !f.comps.length) return "sem comps";
  for (const [i, c] of f.comps.entries())
    if (
      !isObj(c) ||
      typeof c.id !== "string" ||
      !strings(c.units) ||
      !strings(c.key) ||
      typeof c.levelling !== "string" ||
      !strings(c.stars) ||
      !finite(c.avg) ||
      !finite(c.games)
    )
      return `comp ${i} fora do esquema`;
  return null;
}
function validateBuilds(f) {
  if (!isObj(f.units) || !Object.keys(f.units).length) return "sem builds";
  if (!Object.values(f.units).every((ids) => strings(ids) && ids.length))
    return "build fora do esquema";
  if (f.items !== undefined && !isObj(f.items)) return "itens fora do esquema";
  return null;
}
function validateStats(f) {
  if (!stat(f.base)) return "média geral ausente";
  if (!statMap(f.unit) || !Object.keys(f.unit).length) return "sem peças";
  if (!statMap(f.unitItem)) return "peça × item fora do esquema";
  if (!statMap(f.trait) || !Object.keys(f.trait).length) return "sem sinergias";
  return null;
}
function validateAugments(f) {
  if (!isObj(f.augments) || !isObj(f.compTiers))
    return "aprimoramentos fora do esquema";
  if (!Object.keys(f.augments).length && !Object.keys(f.compTiers).length)
    return "sem aprimoramentos";
  return null;
}

/**
 * Os conjuntos: arquivo no repositório, validação do esquema, patch que versiona o snapshot, regra de frescor, download
 * (em pasta de preparo) e forma que o servidor consome. `seed`: o download parte da cópia atual (aprimoramentos
 * mantêm a metade que falhar).
 */
const DATASETS = {
  comps: {
    label: "comps",
    file: "meta-comps.json",
    needsSet: true,
    validate: validateComps,
    patchOf: (f) => f.patch,
    isStale: compsAreStale,
    refresh: refreshComps,
    shape: (file, { set, catalog }) =>
      catalog ? shapeComps(file, set, catalog) : null,
  },
  builds: {
    label: "builds",
    file: "meta-builds.json",
    needsSet: true,
    validate: validateBuilds,
    patchOf: (f) => f.patch,
    isStale: metaIsStale,
    refresh: refreshMeta,
    shape: (file) => shapeBuilds(file),
  },
  stats: {
    label: "estatísticas",
    file: "meta-stats.json",
    needsSet: true,
    validate: validateStats,
    // Peças e sinergias precisam ser do catálogo do set atual (uma tabela baixada sem o recorte vem de outro set).
    inSet: statsSetProblem,
    patchOf: (f) => f.patch,
    isStale: statsAreStale,
    refresh: refreshStats,
    shape: (file) => file,
  },
  augments: {
    label: "aprimoramentos",
    file: "augment-stats.json",
    needsSet: false,
    validate: validateAugments,
    patchOf: () => null,
    isStale: augmentStatsAreStale,
    refresh: (dir, _set, opts) => refreshAugmentStats(dir, opts),
    seed: true,
    shape: (file) => file,
  },
};
export const DATASET_NAMES = Object.keys(DATASETS);
/** Pasta padrão dos snapshots do usuário (fora do Git): `tft/data/meta-store`, ao lado da pasta do helper. */
export const defaultMetaDir = (root) =>
  path.join(root, "..", "data", "meta-store");

/**
 * Esquema da cópia lida: `null` quando serve, senão o motivo de ela não servir. `ids` (catálogo do set atual) liga a
 * checagem de pertença ao set dos conjuntos que a têm; o motivo começa por "fora do set".
 */
function problemOf(d, file, set, ids) {
  if (!isObj(file)) return "não é um objeto JSON";
  if (!finite(Date.parse(file.fetchedAt)))
    return "fetchedAt ausente ou inválido";
  if (d.needsSet && file.set !== set)
    return `é do set ${file.set ?? "desconhecido"}, esperado ${set}`;
  return d.validate(file) ?? d.inSet?.(file, ids) ?? null;
}

/** Idade legível: "menos de 1 min", "12 min", "5 h", "3 d". */
export function formatAge(ms) {
  if (!finite(ms)) return "idade desconhecida";
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/** Tipo da falha de um download: `rede` (sem conexão), `tempo` (estourou o prazo) ou `recusada` (resposta inútil). */
export function failureKind(error) {
  const text = `${error?.name ?? ""} ${error?.message ?? ""} ${error?.cause?.code ?? ""}`;
  if (/Timeout|timed out|timeout|aborted|AbortError/.test(text)) return "tempo";
  if (
    /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|UND_ERR|network/i.test(
      text,
    )
  )
    return "rede";
  return "recusada";
}
const OFFLINE_KINDS = new Set(["rede", "tempo"]);

const patchKey = (patch) =>
  String(patch ?? "sem-patch").replace(/[^\w.-]+/g, "_");

/**
 * Cria a extensão. `root`: pasta do helper (snapshots embarcados); `dir`: onde ficam os snapshots do usuário; `set`: o
 * set esperado (ex.: "TFTSet18"); `catalog` (opcional): o catálogo do set, para recusar dados de outro set. Sem ele vale
 * o `catalog.json` de `root`; sem nenhum dos dois, essa checagem fica desligada. Nada acontece na criação; toda E/S
 * ocorre nas chamadas.
 */
export function createMetaStore({ root, dir, set, catalog = null }) {
  const infos = new Map(); // nome -> última leitura (sem a tentativa de download)
  const attempts = new Map(); // nome -> { at, ok, kind, message }
  const statusFile = path.join(dir, "status.json");
  let idsOnce = null;
  const setIds = () =>
    (idsOnce ??= (
      catalog
        ? Promise.resolve(catalog)
        : fs.readFile(path.join(root, "catalog.json"), "utf8").then(JSON.parse)
    )
      .then(setIdsOf)
      .catch(() => null));

  /** Lê e valida todos os candidatos de um conjunto e escolhe o mais novo que serve. */
  async function read(name) {
    const d = DATASETS[name];
    const candidates = [];
    let entries = [];
    try {
      entries = await fs.readdir(path.join(dir, name));
    } catch {}
    for (const f of entries)
      if (f.startsWith(`${set}__`) && f.endsWith(".json"))
        candidates.push({
          kind: f.endsWith(".prev.json") ? "anterior" : "local",
          path: path.join(dir, name, f),
        });
    candidates.push({
      kind: "repositorio",
      path: path.join(root, d.file),
    });
    const valid = [],
      problems = [],
      ids = await setIds();
    for (const c of candidates) {
      let text;
      try {
        text = await fs.readFile(c.path, "utf8");
      } catch (e) {
        if (e?.code !== "ENOENT")
          problems.push({ ...c, reason: `ilegível: ${e.message}` });
        continue;
      }
      let file;
      try {
        file = JSON.parse(text);
      } catch {
        problems.push({ ...c, reason: "JSON inválido (cópia corrompida)" });
        continue;
      }
      const reason = problemOf(d, file, set, ids);
      if (reason) problems.push({ ...c, reason });
      else valid.push({ ...c, file, text, t: Date.parse(file.fetchedAt) });
    }
    const rank = { local: 0, repositorio: 1, anterior: 2 };
    valid.sort((a, b) => b.t - a.t || rank[a.kind] - rank[b.kind]);
    return { picked: valid[0] ?? null, problems };
  }

  function baseInfo(name, { picked, problems }) {
    const d = DATASETS[name];
    const fetchedAt = picked?.file.fetchedAt ?? null;
    return {
      name,
      origin: picked
        ? picked.kind === "repositorio"
          ? "repositorio"
          : "local"
        : "ausente",
      fetchedAt,
      patch: picked ? (d.patchOf(picked.file) ?? null) : null,
      ageMs: fetchedAt ? Math.max(0, Date.now() - Date.parse(fetchedAt)) : null,
      stale: !picked || d.isStale({ fetchedAt }),
      recovered:
        problems.some((p) => p.kind !== "repositorio") ||
        picked?.kind === "anterior",
      problems: problems.map((p) => ({
        path: p.path,
        reason: p.reason,
      })),
    };
  }

  /** Última leitura do conjunto, com idade e frescor recalculados agora e a última tentativa de download. */
  function infoNow(name) {
    const base = infos.get(name);
    if (!base) return null;
    const fetchedAt = base.fetchedAt;
    return {
      ...base,
      ageMs: fetchedAt ? Math.max(0, Date.now() - Date.parse(fetchedAt)) : null,
      stale: !fetchedAt || DATASETS[name].isStale({ fetchedAt }),
      attempt: attempts.get(name) ?? null,
    };
  }

  const modeOfOne = (i) =>
    !i.stale
      ? "em-dia"
      : i.attempt && !i.attempt.ok && OFFLINE_KINDS.has(i.attempt.kind)
        ? "offline"
        : "desatualizado";

  async function mergeAttempts() {
    try {
      const saved = JSON.parse(await fs.readFile(statusFile, "utf8"));
      for (const [name, a] of Object.entries(saved.attempts ?? {}))
        if (
          name in DATASETS &&
          finite(Date.parse(a?.at)) &&
          !(Date.parse(attempts.get(name)?.at) >= Date.parse(a.at))
        )
          attempts.set(name, a);
    } catch {}
  }
  // Gravações em fila: cada uma tira a foto das tentativas na hora de gravar, então a última a terminar nunca perde as outras.
  let saving = Promise.resolve();
  function saveAttempts() {
    saving = saving.then(async () => {
      try {
        await mergeAttempts();
        await writeFileAtomic(
          statusFile,
          JSON.stringify({ attempts: Object.fromEntries(attempts) }, null, 1),
        );
      } catch {}
    });
    return saving;
  }

  /**
   * Carrega um conjunto: `value` na forma que o servidor consome (comps exige `ctx.catalog`), `info` com origem,
   * `fetchedAt`, patch, idade, frescor e os problemas achados. Sem nenhuma cópia válida, `info.origin` é "ausente".
   */
  async function load(name, ctx = {}) {
    const d = DATASETS[name];
    await mergeAttempts();
    const result = await read(name);
    infos.set(name, baseInfo(name, result));
    return {
      value: d.shape(result.picked?.file ?? null, {
        set,
        catalog: ctx.catalog,
      }),
      info: infoNow(name),
    };
  }

  /** Guarda a cópia validada no arquivo do patch dela; a cópia boa anterior do mesmo patch vira `.prev`. */
  async function promote(name, text, file) {
    const d = DATASETS[name];
    const final = path.join(
      dir,
      name,
      `${set}__${patchKey(d.patchOf(file))}.json`,
    );
    try {
      const current = await fs.readFile(final, "utf8");
      if (!problemOf(d, JSON.parse(current), set, await setIds()))
        await writeFileAtomic(final.replace(/\.json$/, ".prev.json"), current);
    } catch {}
    await writeFileAtomic(final, text);
    await prune(name);
  }

  /** Mantém só os patches mais recentes e apaga restos de gravações interrompidas. */
  async function prune(name) {
    const folder = path.join(dir, name);
    let entries = [];
    try {
      entries = await fs.readdir(folder);
    } catch {
      return;
    }
    const groups = new Map();
    for (const f of entries) {
      const full = path.join(folder, f);
      if (f.endsWith(".tmp")) {
        const s = await fs.stat(full).catch(() => null);
        if (s && Date.now() - s.mtimeMs > 10 * 60_000)
          await fs.rm(full, { force: true }).catch(() => {});
        continue;
      }
      if (!f.startsWith(`${set}__`) || !f.endsWith(".json")) continue;
      const key = f.replace(/\.prev\.json$/, ".json");
      let t = 0;
      try {
        t =
          Date.parse(JSON.parse(await fs.readFile(full, "utf8")).fetchedAt) ||
          0;
      } catch {}
      const g = groups.get(key) ?? { t: 0, files: [] };
      g.t = Math.max(g.t, t);
      g.files.push(full);
      groups.set(key, g);
    }
    const old = [...groups.values()]
      .sort((a, b) => b.t - a.t)
      .slice(KEEP_PATCHES);
    for (const g of old)
      for (const f of g.files) await fs.rm(f, { force: true }).catch(() => {});
  }

  async function sweepStaging() {
    try {
      for (const f of await fs.readdir(dir)) {
        if (!f.startsWith(".staging-")) continue;
        const full = path.join(dir, f);
        const s = await fs.stat(full).catch(() => null);
        if (s && Date.now() - s.mtimeMs > 60 * 60_000)
          await fs.rm(full, { recursive: true, force: true }).catch(() => {});
      }
    } catch {}
  }

  /**
   * Baixa um conjunto numa pasta de preparo, valida e só então guarda. `{ok:true, value, info}` com a cópia nova ou
   * `{ok:false, error, kind, info}` com a cópia anterior intacta. Nunca lança. `ctx.signal` limita o tempo total.
   */
  async function refresh(name, ctx = {}) {
    const d = DATASETS[name];
    let stage = null;
    try {
      await fs.mkdir(dir, { recursive: true });
      await sweepStaging();
      stage = await fs.mkdtemp(path.join(dir, ".staging-"));
      if (d.seed) {
        const { picked } = await read(name);
        if (picked)
          await writeFileAtomic(path.join(stage, d.file), picked.text);
      }
      await d.refresh(stage, set, { signal: ctx.signal });
      const text = await fs.readFile(path.join(stage, d.file), "utf8");
      let file;
      try {
        file = JSON.parse(text);
      } catch {
        throw Error("a cópia baixada não é um JSON legível");
      }
      const reason = problemOf(d, file, set, await setIds());
      if (reason)
        throw Error(`a cópia baixada não passou na validação: ${reason}`);
      await promote(name, text, file);
      attempts.set(name, {
        at: new Date().toISOString(),
        ok: true,
        kind: null,
        message: null,
      });
      await saveAttempts();
      return { ok: true, ...(await load(name, ctx)) };
    } catch (error) {
      attempts.set(name, {
        at: new Date().toISOString(),
        ok: false,
        kind: failureKind(error),
        message: String(error?.message ?? error),
      });
      await saveAttempts();
      if (!infos.has(name)) infos.set(name, baseInfo(name, await read(name)));
      return {
        ok: false,
        error,
        kind: attempts.get(name).kind,
        info: infoNow(name),
      };
    } finally {
      if (stage)
        await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    }
  }

  const loaded = (names = DATASET_NAMES) => names.map(infoNow).filter(Boolean);

  /** Visão curta de um conjunto para a interface: modo, origem, idade e a última tentativa de download. */
  function freshness(name) {
    const i = infoNow(name);
    if (!i) return null;
    return {
      mode: modeOfOne(i),
      origin: i.origin,
      stale: i.stale,
      recovered: i.recovered,
      fetchedAt: i.fetchedAt,
      patch: i.patch,
      ageMs: i.ageMs,
      // Alguma cópia foi recusada por ser de outro set (ids fora do catálogo); a leitura usou a seguinte.
      outOfSet: i.problems.some((p) => p.reason.startsWith(OUT_OF_SET)),
      attempt: i.attempt && {
        ok: i.attempt.ok,
        kind: i.attempt.kind,
        at: i.attempt.at,
      },
    };
  }

  /** Estado geral da extensão (o que já foi carregado): modo, resumo em uma linha e cada conjunto. */
  function status() {
    const list = loaded();
    const mode = !list.length
      ? null
      : list.some((i) => modeOfOne(i) === "offline")
        ? "offline"
        : list.some((i) => modeOfOne(i) === "desatualizado")
          ? "desatualizado"
          : "em-dia";
    return {
      mode,
      summary: summaryLine(list, mode),
      datasets: Object.fromEntries(
        list.map((i) => [i.name, freshness(i.name)]),
      ),
    };
  }

  /**
   * Renova o que está vencido (ou tudo com `force`) em paralelo, com teto `timeoutMs` para o conjunto inteiro. Nunca
   * lança: sem rede devolve `line` dizendo que segue com a cópia local.
   */
  async function sync({
    names = DATASET_NAMES,
    timeoutMs = 12_000,
    force = false,
    catalog,
  } = {}) {
    const signal = AbortSignal.timeout(timeoutMs);
    // Na ordem pedida, não na ordem em que cada download termina (a linha de resumo fica estável).
    const results = Object.fromEntries(
      await Promise.all(
        names.map(async (name) => {
          const cur = await load(name, { catalog });
          if (!force && !cur.info.stale)
            return [name, { status: "em-dia", info: cur.info }];
          const r = await refresh(name, { catalog, signal });
          return [
            name,
            r.ok
              ? { status: "atualizada", info: r.info }
              : {
                  status: "falhou",
                  kind: r.kind,
                  error: r.error,
                  info: r.info,
                },
          ];
        }),
      ),
    );
    const list = loaded(names);
    const state = status();
    return { mode: state.mode, line: syncLine(results, list), results };
  }

  /**
   * Copia a cópia local em uso (a mais nova que passou na validação) para o snapshot embarcado do repositório
   * (`meta-*.json` em `root`). Só por pedido explícito de quem mantém o repositório (`meta-sync --embed`); o servidor
   * nunca chama. Devolve o caminho gravado, ou null quando a cópia em uso já é a do repositório (ou não há cópia).
   */
  async function embed(name) {
    const { picked } = await read(name);
    if (picked?.kind !== "local") return null;
    const target = path.join(root, DATASETS[name].file);
    await writeFileAtomic(target, picked.text);
    return target;
  }

  return { load, refresh, sync, freshness, status, read, embed };
}

const SOURCE_NOTE = {
  local: "cópia local",
  repositorio: "snapshot do repositório",
  ausente: "sem nenhuma cópia",
};
const oldest = (list) =>
  list.reduce(
    (a, i) => (i.ageMs != null && (a == null || i.ageMs > a.ageMs) ? i : a),
    null,
  );

function summaryLine(list, mode) {
  if (!list.length) return "meta ainda não carregada";
  const old = oldest(list);
  const missing = list.filter((i) => i.origin === "ausente");
  const age = old ? `dados de ${formatAge(old.ageMs)} atrás` : "sem dados";
  const note = SOURCE_NOTE[old?.origin ?? "ausente"];
  if (mode === "em-dia") return `meta em dia (${age})`;
  const gap = missing.length
    ? `; sem cópia de ${missing.map((i) => DATASETS[i.name].label).join(", ")}`
    : "";
  return mode === "offline"
    ? `meta offline: ${age} (${note})${gap}`
    : `meta desatualizada: ${age} (${note})${gap}`;
}

/** A linha única do resultado de `sync`: o que foi baixado, o que já estava em dia e o que ficou na cópia local. */
function syncLine(results, list) {
  const names = Object.keys(results);
  const ok = names.filter((n) => results[n].status === "atualizada");
  const failed = names.filter((n) => results[n].status === "falhou");
  const label = (n) => DATASETS[n].label;
  const patch = ["comps", "builds", "stats"]
    .map((n) => results[n]?.info?.patch)
    .find(Boolean);
  if (!failed.length) {
    if (ok.length)
      return `meta atualizada (${ok.map(label).join(", ")}${patch ? `; patch ${patch}` : ""})`;
    return summaryLine(list, "em-dia");
  }
  const old = oldest(list);
  const age = old ? `dados de ${formatAge(old.ageMs)} atrás` : "sem dados";
  const note = SOURCE_NOTE[old?.origin ?? "ausente"];
  const offline = failed.every((n) => OFFLINE_KINDS.has(results[n].kind));
  const why = offline
    ? "sem rede"
    : `${results[failed[0]].error?.message ?? "falha"}`;
  if (ok.length)
    return `meta atualizada em parte (${ok.map(label).join(", ")}); ${why} para ${failed.map(label).join(", ")}: ${age} (${note})`;
  return offline
    ? `meta offline: ${age} (${note})`
    : `meta não atualizada (${why}): ${age} (${note})`;
}
