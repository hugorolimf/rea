// Evidência medida para avaliar tabuleiros: consultas ao explorer da MetaTFT (endpoint não oficial) com filtros
// combinados — peça com estrela e itens, peça presente (qualquer estrela), sinergia no patamar, nível do jogador.
// Filtros repetidos valem "e"; valores separados por vírgula no mesmo filtro valem "ou".
// Cada resposta é a colocação média e o número de partidas dos tabuleiros finais que batem com os filtros.
// Cache em memória e em disco (6 h): numa partida as mesmas perguntas se repetem a cada leitura.
import fs from "node:fs";
import fsp from "node:fs/promises";

const BASE = "https://api-hc.metatft.com/tft-explorer-api/";
const TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 8;

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

/** Cliente do explorer com cache; `file` guarda as respostas entre reinícios do servidor. */
export function explorer(file) {
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
  for (const [k, v] of Object.entries(saved ?? {}))
    if (Date.now() - v?.at < TTL_MS) cache.set(k, v);
  let dirty = false,
    saving = null,
    timer = null;
  // Grava em arquivo temporário e renomeia: quem lê nunca vê o JSON pela metade.
  const persist = () => {
    if (!dirty || saving) return;
    dirty = false;
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
    let failed = false;
    saving = fsp
      .writeFile(tmp, JSON.stringify(Object.fromEntries(cache)))
      .then(() => fsp.rename(tmp, file))
      .catch((e) => {
        // Sem nova tentativa imediata (ex.: EPERM no Windows): a próxima resposta nova agenda outra.
        failed = dirty = true;
        console.warn(`cache de evidência: falha ao gravar (${e.message})`);
        fsp.unlink(tmp).catch(() => {});
      })
      .finally(() => {
        saving = null;
        if (dirty && !failed) persist();
      });
  };
  // Junta as respostas de um lote numa gravação só (2 s depois da última); não segura o processo vivo.
  const schedulePersist = () => {
    clearTimeout(timer);
    timer = setTimeout(persist, 2000);
    timer.unref?.();
  };
  const inflight = new Map();
  async function fetchRows(endpoint, filters) {
    const response = await fetch(`${BASE}${endpoint}?${filters.join("&")}`, {
      signal: AbortSignal.timeout(30000),
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
        cache.set(k, { at: Date.now(), value });
        dirty = true;
        schedulePersist();
        return value;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
    return p;
  }
  const stat = (r) =>
    r && Number.isFinite(r.avg_placement) && r.total_games > 0
      ? {
          avg: Math.round(r.avg_placement * 1000) / 1000,
          games: r.total_games,
          top4: Math.round(r.top4_percentage * 10) / 10,
        }
      : { avg: null, games: 0, top4: null };
  return {
    /** Colocação média dos tabuleiros que batem com todos os filtros. */
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
          return out;
        }),
        cached("traits", [filter], (rows) => {
          const out = {};
          for (const r of rows) {
            const m = /^(.+)_(\d+)$/.exec(r.traits ?? "");
            if (m && r.total_games > 0)
              out[`${m[1]}|${m[2]}`] = [r.avg_placement, r.total_games];
          }
          return out;
        }),
      ]);
      return { units, traits };
    },
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
