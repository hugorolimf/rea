// Comps de meta publicadas pela MetaTFT (endpoints não oficiais): unidades, estilo de nível, unidades a levar
// a 3★, build de cada campeão dentro da comp e a distribuição de colocações. O servidor guarda uma cópia local
// com origem/data e segue com ela se a rede falhar.
import fs from "node:fs/promises";
import path from "node:path";
import { compBuildStats, tierOf } from "./item-edge.mjs";
import { netSignal, writeFileAtomic } from "./meta-files.mjs";
import { fetchCurrentPatch, patchLabel, scopedQuery } from "./meta-scope.mjs";
const BASE = "https://api-hc.metatft.com/tft-comps-api/";
// Colocações das comps no recorte comum (meta-scope.mjs), o mesmo das estatísticas de tabuleiro e da evidência.
const STATS_QUERY = "comps_stats?" + scopedQuery();
// A MetaTFT agrega os últimos 3 dias; renovar a cada 2 h acompanha o dia do patch sem pesar na API.
const MAX_AGE_MS = 2 * 60 * 60 * 1000,
  MIN_GAMES = 5000;
// Tabuleiros por nível guardados de cada comp (a amostra pequena some na conta de level-fit de qualquer jeito).
const BOARDS_PER_LEVEL = 15,
  MIN_BOARD_GAMES = 20;
// Itens de cada campeão na comp (`comp_builds` da MetaTFT): os `PICKS_PER_UNIT` de maior ganho com ao menos
// `MIN_PICK_GAMES` partidas; o ganho é encolhido por n / (n + `PICK_SHRINK_K`) (política deste helper, não medida).
const PICKS_PER_UNIT = 10,
  MIN_PICK_GAMES = 40,
  PICK_SHRINK_K = 400;
const filePath = (root) => path.join(root, "meta-comps.json");
/** Lê a cópia local e resolve nomes com o catálogo; devolve {comps:[], ...} quando ausente ou de outro set. */
export async function loadComps(root, set, catalog) {
  let file = null;
  try {
    file = JSON.parse(await fs.readFile(filePath(root), "utf8"));
  } catch {}
  return shapeComps(file, set, catalog);
}
/**
 * Resolve nomes de uma cópia já lida (null ou de outro set = lista vazia); mesma forma de `loadComps`. Devolve
 * `{ comps, levelBoards: { [compId]: { [nível]: [{ u, n, avg }] } }, label, fetchedAt }`.
 */
export function shapeComps(file, set, catalog) {
  if (file?.set !== set) file = null;
  const champions = new Map(catalog.champions.map((c) => [c.apiName, c])),
    traitName = new Map(catalog.traits.map((t) => [t.apiName, t.name]));
  // Tabuleiros por nível de cada comp (core/comps/level-fit.mjs) ficam à parte: a lista de comps circula pelo pipeline
  // e pelas telas, e eles só servem ao ajuste por nível.
  const levelBoards = {};
  const comps = (file?.comps ?? [])
    .map(({ options, ...c }) => {
      if (options) levelBoards[c.id] = options;
      const units = c.units.filter((id) => champions.has(id));
      if (units.length < 5) return null;
      const title =
        c.key
          .map((k) => champions.get(k)?.name ?? traitName.get(k))
          .filter(Boolean)
          .slice(0, 3)
          .join(" · ") || "Comp de meta";
      const carry = c.key.find((k) => units.includes(k)) ?? null;
      const rerollLevel = /^lvl (\d+)$/.exec(c.levelling)?.[1];
      const maxCost = rerollLevel ? Math.max(1, Number(rerollLevel) - 4) : 0;
      // Alvos de 3★: só fazem sentido em comps de reroll, entre unidades da própria comp e do custo que aquele nível sustenta.
      const stars3 = rerollLevel
        ? c.stars
            .filter(
              (id) => units.includes(id) && champions.get(id).cost <= maxCost,
            )
            .slice(0, 3)
        : [];
      return {
        ...c,
        units,
        title,
        carry,
        stars3,
        rerollLevel: rerollLevel ? Number(rerollLevel) : null,
        tier: tierOf(c.avg),
      };
    })
    .filter(Boolean);
  return {
    comps,
    levelBoards,
    label: file ? "MetaTFT " + (file.patch ?? "") : "",
    fetchedAt: file?.fetchedAt ?? null,
  };
}
/** Baixa comps e estatísticas e regrava a cópia local. Rejeita resposta de outro set ou vazia. */
export async function refreshComps(root, set, { signal } = {}) {
  const get = async (route) => {
    const r = await fetch(BASE + route, { signal: netSignal(30000, signal) });
    if (!r.ok)
      throw Error(
        "MetaTFT respondeu " + r.status + " em " + route.split("?")[0],
      );
    return r.json();
  };
  const [data, stats, currentPatch, options, unitBuilds] = await Promise.all([
    get("comps_data"),
    get(STATS_QUERY),
    fetchCurrentPatch({ signal }),
    // Tabuleiros jogados por nível de cada comp (core/comps/level-fit.mjs); sem eles a comp segue sem `options`.
    get("comp_options").catch(() => null),
    // Builds de 1 a 3 itens de cada campeão em cada comp (core/items/item-priority.mjs); sem elas, só a build publicada.
    get("comp_builds").catch(() => null),
  ]);
  const buildsByComp = unitBuilds?.results ?? {};
  const boardsByComp = options?.results?.options ?? {};
  const details = data?.results?.data;
  if (details?.tft_set !== set)
    throw Error("MetaTFT publicou " + details?.tft_set + ", esperado " + set);
  const places = new Map(
    (stats?.results ?? [])
      .filter((s) => s.cluster && Array.isArray(s.places))
      .map((s) => [s.cluster, s.places.slice(0, 8)]),
  );
  const comps = [];
  for (const [id, d] of Object.entries(details.cluster_details ?? {})) {
    const p = places.get(id);
    if (!p || p.length !== 8) continue;
    const games = p.reduce((a, b) => a + b, 0);
    if (games < MIN_GAMES) continue;
    // Build de cada campeão (a de maior pontuação), com quanto ela muda a colocação nesta comp.
    const buildStats = compBuildStats(d),
      builds = Object.fromEntries(
        Object.entries(buildStats).map(([unit, b]) => [unit, b.items]),
      );
    comps.push({
      id,
      units: String(d.units_string ?? "")
        .split(", ")
        .filter(Boolean),
      key: (d.name ?? []).map((n) => n.name).filter(Boolean),
      levelling: String(d.levelling ?? ""),
      stars: Array.isArray(d.stars) ? d.stars : [],
      builds,
      buildStats,
      games,
      avg:
        Math.round((p.reduce((a, b, i) => a + b * (i + 1), 0) / games) * 100) /
        100,
      top4:
        Math.round((p.slice(0, 4).reduce((a, b) => a + b, 0) / games) * 1000) /
        10,
      win: Math.round((p[0] / games) * 1000) / 10,
      options: levelBoards(boardsByComp[id]),
      itemPicks: itemPicks(buildsByComp[id]?.builds),
    });
  }
  if (!comps.length) throw Error("MetaTFT não devolveu comps.");
  // O `comps_stats` deixou de trazer `filter_adjustment.selected_patch`; vale o patch publicado em unit_items_processed.
  const patch =
    patchLabel(stats?.filter_adjustment?.selected_patch) ?? currentPatch;
  await writeFileAtomic(
    filePath(root),
    JSON.stringify(
      {
        source: BASE + "comps_data + comps_stats + comp_options + comp_builds",
        fetchedAt: new Date().toISOString(),
        set,
        patch,
        comps,
      },
      null,
      1,
    ),
  );
}
/**
 * Tabuleiros da comp por nível (`comp_options` da MetaTFT), compactos: `{ "8": [{ u: [apiName], n, avg }] }`, os
 * `BOARDS_PER_LEVEL` mais jogados de cada nível com ao menos `MIN_BOARD_GAMES` partidas. null quando não veio.
 */
function levelBoards(byLevel) {
  if (!byLevel || typeof byLevel !== "object") return null;
  const out = {};
  for (const [level, list] of Object.entries(byLevel)) {
    if (!Array.isArray(list)) continue;
    const boards = list
      .filter(
        (b) =>
          typeof b?.units_list === "string" &&
          b.count >= MIN_BOARD_GAMES &&
          Number.isFinite(b.avg),
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, BOARDS_PER_LEVEL)
      .map((b) => ({
        u: b.units_list.split("&").filter(Boolean),
        n: b.count,
        avg: Math.round(b.avg * 1000) / 1000,
      }));
    if (boards.length) out[level] = boards;
  }
  return Object.keys(out).length ? out : null;
}
/**
 * Ganho de cada item em cada campeão da comp, das builds publicadas (`comp_builds`: 1, 2 ou 3 itens, cada uma com a
 * variação de colocação `place_change` e as partidas): por item, a média da variação das builds que o contêm, ponderada
 * pelas partidas, com o sinal trocado (positivo = melhora) e encolhida pela amostra. `{ [campeão]: [[item, ganho, n]] }`
 * do maior ganho ao menor; null quando não veio.
 */
function itemPicks(builds) {
  if (!Array.isArray(builds)) return null;
  const acc = new Map();
  for (const b of builds) {
    const n = Number(b?.count),
      d = Number(b?.place_change);
    if (
      !b?.unit ||
      !Array.isArray(b.buildName) ||
      !(n > 0) ||
      !Number.isFinite(d)
    )
      continue;
    const unit = acc.get(b.unit) ?? new Map();
    for (const item of new Set(b.buildName)) {
      const x = unit.get(item) ?? { n: 0, sum: 0 };
      x.n += n;
      x.sum += n * d;
      unit.set(item, x);
    }
    acc.set(b.unit, unit);
  }
  const out = {};
  for (const [unit, items] of acc) {
    const list = [...items]
      .filter(([, x]) => x.n >= MIN_PICK_GAMES)
      .map(([item, x]) => [
        item,
        Math.round((-x.sum / x.n) * (x.n / (x.n + PICK_SHRINK_K)) * 1000) /
          1000,
        x.n,
      ])
      .filter(([, gain]) => gain > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, PICKS_PER_UNIT);
    if (list.length) out[unit] = list;
  }
  return Object.keys(out).length ? out : null;
}
export const compsAreStale = (meta) =>
  !meta.fetchedAt || Date.now() - Date.parse(meta.fetchedAt) > MAX_AGE_MS;
