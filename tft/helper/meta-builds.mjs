// Builds de meta por campeão: lista ordenada de itens publicada pela MetaTFT (endpoint não oficial).
// O servidor guarda uma cópia local com origem/data e segue funcionando com ela se a rede falhar.
import fs from "node:fs/promises";
import path from "node:path";
import { itemRole } from "./core/catalog/items.mjs";
import { netSignal, writeFileAtomic } from "./meta-files.mjs";
import { PATCH_SOURCE, patchLabel } from "./meta-scope.mjs";
// A mesma resposta que publica o patch atual (meta-scope.mjs).
export const META_SOURCE = PATCH_SOURCE;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
// Papel inferido dos cinco primeiros itens de meta (papel do item: core/catalog/items.mjs); empate ou lista curta
// devolve null e o chamador usa sua heurística.
function roleOf(ids) {
  const n = { tank: 0, ap: 0, ad: 0 };
  for (const id of ids.slice(0, 5)) {
    const role = itemRole(id);
    if (role !== "flex") n[role]++;
  }
  const ranked = Object.entries(n).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] >= 2 && ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}
/** Mapas de builds e papéis de uma cópia já lida (null = vazio); mesma forma de `loadMeta`. */
export function shape(file) {
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
    // Desempenho por item (colocação média, partidas, uso, campeões que mais usam) para o tier de itens.
    items: file?.items ?? {},
    games: file?.games ?? null,
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
export async function refreshMeta(root, set, { signal } = {}) {
  const response = await fetch(META_SOURCE, {
    signal: netSignal(20000, signal),
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
  const items = {};
  for (const [id, s] of Object.entries(raw.itemNames ?? {}))
    if (Number.isFinite(s?.avg) && s.count > 0)
      items[id] = {
        count: s.count,
        avg: s.avg,
        pick: Number.isFinite(s.pick) ? s.pick : null,
        units: (s.units ?? [])
          .map((u) => u.unit)
          .filter((u) => typeof u === "string"),
      };
  const file = {
    source: META_SOURCE,
    fetchedAt: new Date().toISOString(),
    set,
    patch: patchLabel(raw.region_patch_adjustment?.selected_patch),
    units,
    items,
    games: Number.isFinite(raw.overall?.count) ? raw.overall.count : null,
  };
  await writeFileAtomic(filePath(root), JSON.stringify(file, null, 1));
  return shape(file);
}
export const metaIsStale = (meta) =>
  !meta.fetchedAt || Date.now() - Date.parse(meta.fetchedAt) > MAX_AGE_MS;
