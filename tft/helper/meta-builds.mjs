// Builds de meta por campeão: lista ordenada de itens publicada pela MetaTFT (endpoint não oficial).
// O servidor guarda uma cópia local com origem/data e segue funcionando com ela se a rede falhar.
import fs from "node:fs/promises";
import path from "node:path";
export const META_SOURCE =
  "https://api-hc.metatft.com/tft-comps-api/unit_items_processed";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TANK =
  /Gargoyle|Warmog|SpiritVisage|Crownguard|DragonsClaw|ProtectorsVow|Steadfast|Sunfire|Bramble|AdaptiveHelm|Redemption|Evenshroud/;
const AP = /Rabadon|Jeweled|Archangel|VoidStaff|Nashor|Shojin|BlueBuff|Morello/;
const AD =
  /InfinityEdge|Deathblade|LastWhisper|GiantSlayer|Kraken|Bloodthirster|EdgeOfNight|Sterak|Titans|HandOfJustice|RedBuff|Runaan/;
// Papel inferido dos cinco primeiros itens de meta; empate ou lista curta devolve null e o chamador usa sua heurística.
function roleOf(ids) {
  const n = { tank: 0, ap: 0, ad: 0 };
  for (const id of ids.slice(0, 5)) {
    if (TANK.test(id)) n.tank++;
    else if (AP.test(id)) n.ap++;
    else if (AD.test(id)) n.ad++;
  }
  const ranked = Object.entries(n).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] >= 2 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}
function shape(file) {
  const builds = new Map(),
    roles = new Map();
  for (const [id, ids] of Object.entries(file?.units ?? {})) {
    if (!Array.isArray(ids) || !ids.length) continue;
    builds.set(id, ids);
    const r = roleOf(ids);
    if (r) roles.set(id, r);
  }
  return {
    builds,
    roles,
    label: file ? "MetaTFT " + (file.patch ?? "patch desconhecido") : "",
    fetchedAt: file?.fetchedAt ?? null,
    set: file?.set ?? null,
  };
}
const filePath = (root) => path.join(root, "meta-builds.json");
/** Lê a cópia local; devolve mapas vazios quando ela não existe ou não é do set esperado. */
export async function loadMeta(root, set) {
  try {
    const file = JSON.parse(await fs.readFile(filePath(root), "utf8"));
    return file.set === set ? shape(file) : shape(null);
  } catch {
    return shape(null);
  }
}
/** Baixa a lista atual e regrava a cópia local. Rejeita resposta de outro set ou sem unidades. */
export async function refreshMeta(root, set) {
  const response = await fetch(META_SOURCE, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw Error("MetaTFT respondeu " + response.status);
  const raw = await response.json();
  if (raw.tft_set !== set)
    throw Error("MetaTFT publicou " + raw.tft_set + ", esperado " + set);
  const units = {};
  for (const [id, u] of Object.entries(raw.units ?? {})) {
    const ids = (u.items ?? [])
      .map((i) => i.itemName)
      .filter((i) => typeof i === "string");
    if (ids.length) units[id] = ids;
  }
  if (!Object.keys(units).length) throw Error("MetaTFT não devolveu builds.");
  const patch = raw.region_patch_adjustment?.selected_patch;
  const file = {
    source: META_SOURCE,
    fetchedAt: new Date().toISOString(),
    set,
    patch: patch ? patch.patch + (patch.b_patch_version ?? "") : null,
    units,
  };
  await fs.writeFile(filePath(root), JSON.stringify(file, null, 1));
  return shape(file);
}
export const metaIsStale = (meta) =>
  !meta.fetchedAt || Date.now() - Date.parse(meta.fetchedAt) > MAX_AGE_MS;
