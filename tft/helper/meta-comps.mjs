// Comps de meta publicadas pela MetaTFT (endpoints não oficiais): unidades, estilo de nível, unidades a levar
// a 3★, build de cada campeão dentro da comp e a distribuição de colocações. O servidor guarda uma cópia local
// com origem/data e segue com ela se a rede falhar.
import fs from "node:fs/promises";
import path from "node:path";
const BASE = "https://api-hc.metatft.com/tft-comps-api/";
const STATS_QUERY =
  "comps_stats?queue=1100&patch=current&days=3&rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM&permit_filter_adjustment=true";
const MAX_AGE_MS = 6 * 60 * 60 * 1000,
  MIN_GAMES = 5000;
// Faixas próprias deste helper sobre a colocação média (1 a 8, menor é melhor); não são os tiers da MetaTFT.
const tierOf = (avg) =>
  avg <= 4.25 ? "S" : avg <= 4.4 ? "A" : avg <= 4.6 ? "B" : "C";
const filePath = (root) => path.join(root, "meta-comps.json");
/** Lê a cópia local e resolve nomes com o catálogo; devolve {comps:[], ...} quando ausente ou de outro set. */
export async function loadComps(root, set, catalog) {
  let file = null;
  try {
    file = JSON.parse(await fs.readFile(filePath(root), "utf8"));
    if (file.set !== set) file = null;
  } catch {}
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
export async function refreshComps(root, set) {
  const get = async (route) => {
    const r = await fetch(BASE + route, { signal: AbortSignal.timeout(30000) });
    if (!r.ok)
      throw Error(
        "MetaTFT respondeu " + r.status + " em " + route.split("?")[0],
      );
    return r.json();
  };
  const [data, stats] = await Promise.all([
    get("comps_data"),
    get(STATS_QUERY),
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
    const builds = {};
    for (const b of [...(d.builds ?? [])].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    ))
      if (b.unit && Array.isArray(b.buildName) && !builds[b.unit])
        builds[b.unit] = b.buildName;
    comps.push({
      id,
      units: String(d.units_string ?? "")
        .split(", ")
        .filter(Boolean),
      key: (d.name ?? []).map((n) => n.name).filter(Boolean),
      levelling: String(d.levelling ?? ""),
      stars: Array.isArray(d.stars) ? d.stars : [],
      builds,
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
  const patch = stats?.filter_adjustment?.selected_patch ?? null;
  await fs.writeFile(
    filePath(root),
    JSON.stringify(
      {
        source: BASE + "comps_data + comps_stats",
        fetchedAt: new Date().toISOString(),
        set,
        patch: patch ? patch.patch + (patch.b_patch_version ?? "") : null,
        comps,
      },
      null,
      1,
    ),
  );
}
export const compsAreStale = (meta) =>
  !meta.fetchedAt || Date.now() - Date.parse(meta.fetchedAt) > MAX_AGE_MS;
