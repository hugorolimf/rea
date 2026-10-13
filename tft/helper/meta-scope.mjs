// Recorte da MetaTFT que o assistente usa, em um lugar só: fila ranqueada, patch atual, últimos 3 dias, Platina para
// cima. Vale para as comps (`tft-comps-api/comps_stats`, meta-comps.mjs), para as estatísticas de tabuleiro
// (`tft-explorer-api/*`, meta-stats.mjs) e para as perguntas de evidência (evidence.mjs). Sem o recorte o explorer devolve
// uma base antiga de outro set (em 2026-10-11: 12.616 tabuleiros com ids TFT17_*, contra 7,5 milhões do Set 18 com ele).
//
// Aqui também moram o patch publicado (que versiona os snapshots) e a regra "estes dados são do set atual?", medida
// contra os ids do catálogo (catalog.json): estatística ou evidência cujas peças não estão no catálogo é "fora do set".
import { netSignal } from "./meta-files.mjs";

/** Filtros do recorte, na forma de query string (os mesmos para comps, explorer e evidência). */
export const METATFT_SCOPE = [
  "queue=1100",
  "patch=current",
  "days=3",
  "rank=CHALLENGER,DIAMOND,EMERALD,GRANDMASTER,MASTER,PLATINUM",
  "permit_filter_adjustment=true",
].join("&");

/** Query string de uma consulta: o recorte e, depois, os filtros da pergunta (`unit_tier_numitems_unique=…`, `trait=…`). */
export const scopedQuery = (filters = []) =>
  [METATFT_SCOPE, ...filters].join("&");

/**
 * Etiqueta curta do recorte (hash de `METATFT_SCOPE`): marca cada resposta guardada no cache de evidência. Resposta
 * sem a etiqueta, ou com a de outro recorte, foi perguntada de outro jeito e não é reaproveitada.
 */
export const SCOPE_TAG = (() => {
  let h = 5381;
  for (const ch of METATFT_SCOPE) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `r${h.toString(36)}`;
})();

/** Onde a MetaTFT publica o patch atual (`region_patch_adjustment.selected_patch`); 66 KB. */
export const PATCH_SOURCE =
  "https://api-hc.metatft.com/tft-comps-api/unit_items_processed";

/** "18.4b" a partir de `selected_patch` (`{patch: "18.4", b_patch_version: "b"}`); null quando ausente. */
export const patchLabel = (selected) =>
  typeof selected?.patch === "string" && selected.patch
    ? selected.patch + (selected.b_patch_version ?? "")
    : null;

/**
 * Patch atual publicado pela MetaTFT, ou null em qualquer falha: o patch só nomeia o snapshot, então a falta dele
 * não derruba o download de comps nem de estatísticas.
 */
export async function fetchCurrentPatch({ signal } = {}) {
  try {
    const response = await fetch(PATCH_SOURCE, {
      signal: netSignal(15000, signal),
    });
    if (!response.ok) return null;
    const raw = await response.json();
    return patchLabel(raw?.region_patch_adjustment?.selected_patch);
  } catch {
    return null;
  }
}

/** Marca de dado recusado por não ser do set atual (aparece nos problemas da leitura e nos avisos do cache). */
export const OUT_OF_SET = "fora do set";

/** Ids do set atual no catálogo: `{champions, traits}` (Sets de apiName); null sem catálogo utilizável. */
export function setIdsOf(catalog) {
  if (!Array.isArray(catalog?.champions) || !catalog.champions.length)
    return null;
  return {
    champions: new Set(catalog.champions.map((c) => c?.apiName)),
    traits: new Set((catalog.traits ?? []).map((t) => t?.apiName)),
  };
}

// Fração mínima dos campeões e das sinergias do catálogo que uma tabela do set atual cobre. A do Set 18 cobre 65 de 74
// campeões e 36 de 36 sinergias; a baixada sem o recorte, 0 e 0.
const MIN_COVERAGE = 0.5;

/**
 * Problema de pertença ao set de uma cópia de meta-stats (`unit["id|…"]`, `trait["api|patamar"]`): null quando ela
 * cobre o catálogo, senão o motivo, começando por "fora do set". Sem `ids` não há como medir: null.
 */
export function statsSetProblem(file, ids) {
  if (!ids) return null;
  const units = new Set(
    Object.keys(file?.unit ?? {}).map((k) => k.split("|")[0]),
  );
  const traits = new Set(
    Object.keys(file?.trait ?? {}).map((k) => k.split("|")[0]),
  );
  const hitUnits = [...ids.champions].filter((id) => units.has(id)).length;
  const hitTraits = [...ids.traits].filter((id) => traits.has(id)).length;
  if (
    hitUnits >= MIN_COVERAGE * ids.champions.size &&
    hitTraits >= MIN_COVERAGE * ids.traits.size
  )
    return null;
  const sample = [...units].find((id) => !ids.champions.has(id));
  return (
    `${OUT_OF_SET}: ${hitUnits} de ${ids.champions.size} campeões e ${hitTraits} de ${ids.traits.size} sinergias do ` +
    `catálogo têm estatística${sample ? ` (ids de outro set, ex.: ${sample})` : ""}`
  );
}

/**
 * Ids citados por uma pergunta ao explorer, a partir da chave do cache (`endpoint?filtro&filtro`): campeões de
 * `unit_tier_numitems_unique=ID-1_e_i,…`, `unit=ID` / `unit=!ID` e sinergias de `trait=API_patamar`.
 */
export function evidenceIds(key) {
  const units = [],
    traits = [];
  for (const part of String(key)
    .slice(String(key).indexOf("?") + 1)
    .split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq);
    for (const raw of part.slice(eq + 1).split(",")) {
      const v = raw.replace(/^!/, "");
      if (name === "unit_tier_numitems_unique") {
        const m = /^(.+)-1_\d_\d$/.exec(v);
        if (m) units.push(m[1]);
      } else if (name === "unit") units.push(v.replace(/-1$/, ""));
      else if (name === "unit_item") {
        // "<campeão>%26<item>" (evidence.mjs unitItem): o campeão entra na checagem do set.
        const unit = decodeURIComponent(v).split("&")[0];
        if (unit) units.push(unit);
      } else if (name === "trait") {
        const m = /^(.+)_\d+$/.exec(v);
        if (m) traits.push(m[1]);
      }
    }
  }
  return { units, traits };
}

/** Ids de `{units, traits}` que não estão no catálogo do set atual (lista vazia sem `ids`). */
export const outOfSetIds = ({ units = [], traits = [] }, ids) =>
  ids
    ? [
        ...units.filter((u) => !ids.champions.has(u)),
        ...traits.filter((t) => !ids.traits.has(t)),
      ]
    : [];
