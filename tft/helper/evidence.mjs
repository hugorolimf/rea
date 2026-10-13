// Evidência medida para avaliar tabuleiros: consultas ao explorer da MetaTFT (endpoint não oficial) com filtros
// combinados — peça com estrela e itens, peça presente (qualquer estrela), sinergia no patamar, nível do jogador.
// Filtros repetidos valem "e"; valores separados por vírgula no mesmo filtro valem "ou".
// Cada resposta é a colocação média, a taxa de vitória (1º lugar), o top 4 e o número de partidas dos tabuleiros finais
// que batem com os filtros.
// Cache em memória e em disco (6 h): numa partida as mesmas perguntas se repetem a cada leitura.
// Toda pergunta vai com o recorte de meta-scope.mjs (o mesmo das comps e de meta-stats): sem ele o explorer responde com
// outro set e toda pergunta do set atual volta com 0 partidas.
import fs from "node:fs";
import fsp from "node:fs/promises";
import {
  evidenceIds,
  OUT_OF_SET,
  outOfSetIds,
  SCOPE_TAG,
  scopedQuery,
} from "./meta-scope.mjs";

const BASE = "https://api-hc.metatft.com/tft-explorer-api/";
const TTL_MS = 6 * 60 * 60 * 1000;
// Um cache com pelo menos tantas respostas, todas com 0 partidas, foi perguntado no recorte errado: não é usado.
const MIN_EMPTY_CACHE = 5;
// Perguntas em paralelo ao explorer (cada uma ~0,5 s; o `fetch` do Node reaproveita a conexão).
const CONCURRENCY = 16;
// Gravação do cache em disco: no mínimo 30 s entre uma e outra e serialização em fatias de 1.000 entradas.
const PERSIST_GAP_MS = 30_000;
const SERIALIZE_SLICE = 1000;
// Espera máxima por pergunta ao explorer (era 30 s; uma pergunta só custa ~0,5 s e o POST esperava até 3 x 30 s).
const FETCH_TIMEOUT_MS = 15_000;

/** Filtro "peça com estas estrelas e esta quantidade de itens" (uma cópia no tabuleiro). */
export const exactUnit = (id, stars, items) =>
  `unit_tier_numitems_unique=${id}-1_${stars}_${Math.min(3, items)}`;
/** Filtro "peça com estas estrelas", com qualquer quantidade de itens. */
export const starUnit = (id, stars) =>
  `unit_tier_numitems_unique=${[0, 1, 2, 3].map((n) => `${id}-1_${stars}_${n}`).join(",")}`;
/** Filtro "peça presente com até estas estrelas", com qualquer quantidade de itens. */
export const unitUpTo = (id, maxStars) =>
  `unit_tier_numitems_unique=${[1, 2, 3]
    .filter((s) => s <= maxStars)
    .flatMap((s) => [0, 1, 2, 3].map((n) => `${id}-1_${s}_${n}`))
    .join(",")}`;
/** Filtro "peça presente", com qualquer estrela e quantidade de itens. */
export const anyUnit = (id) =>
  `unit_tier_numitems_unique=${[1, 2, 3]
    .flatMap((s) => [0, 1, 2, 3].map((n) => `${id}-1_${s}_${n}`))
    .join(",")}`;
/**
 * Filtro "este campeão com este item" (o explorer aceita `unit_item=<campeão>&<item>`, com o `&` codificado): mede os
 * tabuleiros em que o item está NAQUELE campeão, não em qualquer peça (`item=<id>`).
 */
export const unitItem = (id, item) =>
  `unit_item=${encodeURIComponent(`${id}&${item}`)}`;
/** Filtro "sinergia no patamar" (patamar = índice do breakpoint, 1 = o primeiro). */
export const traitAt = (api, tier) => `trait=${api}_${tier}`;
/** Chave canônica de um conjunto de filtros (a ordem não muda a pergunta). */
export const filterKey = (filters) => [...filters].sort().join("&");

/**
 * Trunfos: as suas peças ordenadas pela colocação média medida daquela peça com aquela estrela e quantidade
 * de itens (meta-stats.json). Devolve [{id, stars, items, avg, games, filter}] das que têm amostra.
 */
export function assetsOf(units, stats, { minGames = 300, limit = 2 } = {}) {
  const best = new Map();
  for (const u of units) {
    const items = Math.min(3, u.items?.length ?? 0),
      s = stats?.unit?.[`${u.id}|${u.stars}|${items}`];
    if (!s || s[1] < minGames) continue;
    const prev = best.get(u.id);
    if (!prev || s[0] < prev.avg)
      best.set(u.id, {
        id: u.id,
        stars: u.stars,
        items,
        avg: s[0],
        games: s[1],
        filter: exactUnit(u.id, u.stars, items),
      });
  }
  return [...best.values()].sort((a, b) => a.avg - b.avg).slice(0, limit);
}

/** Total guardado antes da vitória entrar nas respostas: mediu tabuleiros, mas não tem a chave `win`. */
const oldTotal = (value) =>
  value !== null &&
  typeof value === "object" &&
  value.games > 0 &&
  !("win" in value);

/** A resposta guardada mediu algum tabuleiro? (`total`: partidas > 0; condicional: alguma peça ou sinergia). */
const measured = (value) =>
  value !== null &&
  typeof value === "object" &&
  ("games" in value ? value.games > 0 : Object.keys(value).length > 0);

/**
 * Separa o cache lido do disco no que serve e no que é recusado: vencido (TTL), perguntado sem o recorte atual
 * (`scope` ausente ou de outro recorte), "fora do set" (cita peça ou sinergia fora do catálogo `ids`), total no formato
 * antigo (sem a taxa de vitória, `format`) e, por último, o cache inteiro quando todas as respostas que sobraram têm 0
 * partidas. Devolve `{kept: [[chave, entrada]], rejected}`.
 */
export function screenCache(saved, { ids = null, now = Date.now() } = {}) {
  const rejected = { expired: 0, scope: 0, outOfSet: 0, format: 0, empty: 0 };
  let kept = [];
  for (const [k, v] of Object.entries(saved ?? {})) {
    if (!(now - v?.at < TTL_MS)) rejected.expired++;
    else if (v.scope !== SCOPE_TAG) rejected.scope++;
    else if (outOfSetIds(evidenceIds(k), ids).length) rejected.outOfSet++;
    else if (k.startsWith("total?") && oldTotal(v.value)) rejected.format++;
    else kept.push([k, v]);
  }
  if (
    kept.length >= MIN_EMPTY_CACHE &&
    !kept.some(([, v]) => measured(v.value))
  ) {
    rejected.empty = kept.length;
    kept = [];
  }
  return { kept, rejected };
}

/** Texto do aviso de cache recusado (null quando nada relevante foi recusado; vencidas não contam). */
function rejectedNote({ scope, outOfSet, format = 0, empty }) {
  const parts = [
    scope && `${scope} sem o recorte de set/patch atual`,
    outOfSet && `${outOfSet} ${OUT_OF_SET} (peça ou sinergia fora do catálogo)`,
    format && `${format} sem a taxa de vitória (formato antigo)`,
    empty && `${empty} de um cache inteiro com 0 partidas`,
  ].filter(Boolean);
  return parts.length
    ? `cache de evidência: respostas descartadas (${parts.join("; ")}); serão perguntadas de novo`
    : null;
}

/**
 * Cliente do explorer com cache; `file` guarda as respostas entre reinícios do servidor. `ids` (de `setIdsOf(catalog)`)
 * liga a recusa do que é "fora do set": no cache lido e nas respostas condicionais novas.
 */
export function explorer(
  file,
  {
    minGapMs = PERSIST_GAP_MS,
    fetchTimeoutMs = FETCH_TIMEOUT_MS,
    ids = null,
  } = {},
) {
  const cache = new Map(),
    tmp = `${file}.tmp`;
  // Lê o arquivo principal; se estiver ilegível, tenta a gravação temporária que não chegou a ser renomeada.
  const load = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        console.warn(`cache de evidência: ${f} descartado (${e.message})`);
      return null;
    }
  };
  const saved = load(file) ?? (fs.existsSync(tmp) ? load(tmp) : null);
  const screened = screenCache(saved, { ids });
  for (const [k, v] of screened.kept) cache.set(k, v);
  const note = rejectedNote(screened.rejected);
  if (note) console.warn(note);
  let dirty = false,
    saving = null,
    timer = null,
    lastWriteAt = 0;
  // Gravações desde a última `takeStats()` (instrumentação do server.log): quantas, quanto tempo de relógio e bytes.
  const written = { n: 0, ms: 0, bytes: 0 };
  // Serializa em fatias, cedendo o event loop entre elas: o arquivo passa de 7 MB e um `JSON.stringify` único
  // bloqueava o loop por ~120 ms (e crescendo) a cada gravação. O texto é o mesmo de JSON.stringify(Object.fromEntries).
  const serialize = async () => {
    const entries = [...cache],
      parts = [];
    for (let i = 0; i < entries.length; i += SERIALIZE_SLICE) {
      for (const [k, v] of entries.slice(i, i + SERIALIZE_SLICE))
        parts.push(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    return `{${parts.join(",")}}`;
  };
  // Grava em arquivo temporário e renomeia: quem lê nunca vê o JSON pela metade.
  const persist = () => {
    if (!dirty || saving) return;
    dirty = false;
    lastWriteAt = Date.now();
    const now = lastWriteAt,
      t0 = performance.now();
    for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
    let failed = false;
    saving = serialize()
      .then(async (text) => {
        await fsp.writeFile(tmp, text);
        await fsp.rename(tmp, file);
        written.n++;
        written.ms += performance.now() - t0;
        written.bytes += text.length;
      })
      .catch((e) => {
        // Sem nova tentativa imediata (ex.: EPERM no Windows): a próxima resposta nova agenda outra.
        failed = dirty = true;
        console.warn(`cache de evidência: falha ao gravar (${e.message})`);
        fsp.unlink(tmp).catch(() => {});
      })
      .finally(() => {
        saving = null;
        if (dirty && !failed) schedulePersist();
      });
  };
  // Espaça as gravações: a primeira resposta nova agenda a gravação (mín. 2 s, para juntar o lote) e depois só
  // volta a gravar `minGapMs` após a anterior; respostas que chegam enquanto isso entram na próxima. Custo: uma
  // queda do processo perde no máximo as respostas do último intervalo (voltam a ser perguntadas). Não segura o processo vivo.
  const schedulePersist = () => {
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        persist();
      },
      Math.max(2000, lastWriteAt + minGapMs - Date.now()),
    );
    timer.unref?.();
  };
  const inflight = new Map();
  async function fetchRows(endpoint, filters) {
    const response = await fetch(`${BASE}${endpoint}?${scopedQuery(filters)}`, {
      signal: AbortSignal.timeout(fetchTimeoutMs),
    });
    if (!response.ok)
      throw Error(`MetaTFT ${endpoint} respondeu ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows))
      throw Error(`MetaTFT ${endpoint}: resposta sem lista`);
    return rows;
  }
  async function cached(endpoint, filters, shape) {
    const k = `${endpoint}?${filterKey(filters)}`,
      hit = cache.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    if (inflight.has(k)) return inflight.get(k);
    const p = fetchRows(endpoint, filters)
      .then((rows) => {
        const value = shape(rows);
        cache.set(k, { at: Date.now(), scope: SCOPE_TAG, value });
        dirty = true;
        schedulePersist();
        return value;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }
  // Resposta condicional em que a maioria das peças (ou sinergias) não está no catálogo do set atual: é de outro set.
  // Lança em vez de devolver, para não entrar no cache; quem pergunta trata a falha como "sem resposta".
  const inSet = (endpoint, out, idsOf) => {
    const keys = Object.keys(out);
    const off = keys.filter((k) => outOfSetIds(idsOf(k), ids).length);
    if (keys.length && off.length * 2 > keys.length)
      throw Error(
        `MetaTFT ${endpoint}: resposta ${OUT_OF_SET} (${off.length} de ${keys.length}, ex.: ${off[0]})`,
      );
    return out;
  };
  const stat = (r) =>
    r && Number.isFinite(r.avg_placement) && r.total_games > 0
      ? {
          avg: Math.round(r.avg_placement * 1000) / 1000,
          games: r.total_games,
          top4: Math.round(r.top4_percentage * 10) / 10,
          // Vitória (1º lugar) em %: a medida que ordena as comps (core/comps/win.mjs). null quando o explorer não a manda.
          win: Number.isFinite(r.win_percentage)
            ? Math.round(r.win_percentage * 100) / 100
            : null,
        }
      : { avg: null, games: 0, top4: null, win: null };
  return {
    /** Grava já o que está pendente (ignora o espaçamento); resolve quando a gravação em andamento termina. */
    async flush() {
      clearTimeout(timer);
      timer = null;
      await saving;
      persist();
      await saving;
    },
    /** Gravações do cache desde a última chamada, em texto para o server.log: `evidencia gravou=N ms=M KB=K`. */
    takeStats() {
      const text = `evidencia gravou=${written.n} ms=${written.ms.toFixed(0)} KB=${(written.bytes / 1024).toFixed(0)}`;
      Object.assign(written, { n: 0, ms: 0, bytes: 0 });
      return text;
    },
    /** Colocação média, vitória, top 4 e partidas dos tabuleiros que batem com todos os filtros. */
    total: (filters) => cached("total", filters, (rows) => stat(rows[0])),
    /**
     * Dado um filtro (o trunfo), a colocação de cada peça presente e de cada sinergia × patamar junto com ele:
     * {units: {id: [avg, games]}, traits: {"api|patamar": [avg, games]}}.
     */
    async conditional(filter) {
      const [units, traits] = await Promise.all([
        cached("units_unique", [filter], (rows) => {
          const out = {};
          for (const r of rows) {
            const m = /^(.+)-1$/.exec(r.units_unique ?? "");
            if (m && r.total_games > 0)
              out[m[1]] = [r.avg_placement, r.total_games];
          }
          return inSet("units_unique", out, (id) => ({ units: [id] }));
        }),
        cached("traits", [filter], (rows) => {
          const out = {};
          for (const r of rows) {
            const m = /^(.+)_(\d+)$/.exec(r.traits ?? "");
            if (m && r.total_games > 0)
              out[`${m[1]}|${m[2]}`] = [r.avg_placement, r.total_games];
          }
          return inSet("traits", out, (k) => ({ traits: [k.split("|")[0]] }));
        }),
      ]);
      return { units, traits };
    },
    /** O que a leitura do cache em disco recusou (vencidas, sem recorte, fora do set, cache inteiro vazio) e o que ficou. */
    health: () => ({ kept: screened.kept.length, rejected: screened.rejected }),
    /** Resolve várias consultas de total em paralelo (limite de conexões); falhas viram null. */
    async totals(filterSets) {
      const out = new Map(),
        queue = [...new Map(filterSets.map((f) => [filterKey(f), f]))];
      await Promise.all(
        Array.from(
          { length: Math.min(CONCURRENCY, queue.length) },
          async () => {
            while (queue.length) {
              const [k, f] = queue.shift();
              try {
                out.set(k, await this.total(f));
              } catch {
                out.set(k, null);
              }
            }
          },
        ),
      );
      return out;
    },
  };
}
