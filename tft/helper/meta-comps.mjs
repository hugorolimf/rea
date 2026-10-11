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
const filePath = (root) => path.join(root, "meta-comps.json");
/** Lê a cópia local e resolve nomes com o catálogo; devolve {comps:[], ...} quando ausente ou de outro set. */
export async function loadComps(root, set, catalog) {
  let file = null;
  try {
    file = JSON.parse(await fs.readFile(filePath(root), "utf8"));
  } catch {}
  return shapeComps(file, set, catalog);
}
/** Resolve nomes de uma cópia já lida (null ou de outro set = lista vazia); mesma forma de `loadComps`. */
export function shapeComps(file, set, catalog) {
  if (file?.set !== set) file = null;
  const champions = new Map(catalog.champions.map((c) => [c.apiName, c])),
    traitName = new Map(catalog.traits.map((t) => [t.apiName, t.name]));
  const comps = (file?.comps ?? [])
    .map((c) => {
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
  const [data, stats, currentPatch] = await Promise.all([
    get("comps_data"),
    get(STATS_QUERY),
    fetchCurrentPatch({ signal }),
  ]);
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
        source: BASE + "comps_data + comps_stats",
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
export const compsAreStale = (meta) =>
  !meta.fetchedAt || Date.now() - Date.parse(meta.fetchedAt) > MAX_AGE_MS;
