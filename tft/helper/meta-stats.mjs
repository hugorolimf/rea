// Estatísticas de colocação medidas pela MetaTFT (explorer, endpoints não oficiais): colocação média e número
// de partidas por campeão × estrela × quantidade de itens, por campeão × item e por sinergia × patamar.
// Servem para escolher os trunfos (suas peças com estrela e itens de melhor colocação medida) e o emblema que
// mais rende; os tabuleiros inteiros são medidos pelo explorer (evidence.mjs). O servidor guarda uma cópia local com origem/data e segue com ela se a rede falhar.
// Toda tabela é pedida com o recorte de meta-scope.mjs (o mesmo das comps): sem ele o explorer devolve outro set.
import fs from "node:fs/promises";
import path from "node:path";
import { netSignal, writeFileAtomic } from "./meta-files.mjs";
import {
  fetchCurrentPatch,
  METATFT_SCOPE,
  scopedQuery,
} from "./meta-scope.mjs";

const BASE = "https://api-hc.metatft.com/tft-explorer-api/";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const filePath = (root) => path.join(root, "meta-stats.json");

const stat = (r) =>
  Number.isFinite(r?.avg_placement) && r.total_games > 0
    ? [Math.round(r.avg_placement * 1000) / 1000, r.total_games]
    : null;

async function get(name, signal) {
  const response = await fetch(`${BASE}${name}?${scopedQuery()}`, {
    signal: netSignal(40000, signal),
  });
  if (!response.ok) throw Error(`MetaTFT ${name} respondeu ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error(`MetaTFT ${name}: resposta sem lista`);
  return rows;
}

/**
 * Baixa as tabelas e regrava a cópia local. Formato compacto: cada estatística é [média, partidas].
 * - `unit["id|estrelas|itens"]` (itens 0..3), `unit["id|estrelas"]`, `unit["id"]`;
 * - `unitItem["id|item"]` (o campeão com aquele item, uma cópia);
 * - `trait["apiName|patamar"]` (patamar = índice do breakpoint, 1 = o primeiro).
 */
export async function refreshStats(root, set, { signal } = {}) {
  const [total, tiers, numItems, unitItems, traits, patch] = await Promise.all([
    get("total", signal),
    get("unit_tier", signal),
    get("unit_tier_numitems_unique", signal),
    get("unit_items_unique", signal),
    get("traits", signal),
    fetchCurrentPatch({ signal }),
  ]);
  const unit = {},
    unitItem = {},
    trait = {};
  for (const r of tiers) {
    const m = /^(.+)_(\d)$/.exec(r.unit_tier ?? ""),
      s = stat(r);
    if (m && s) unit[`${m[1]}|${m[2]}`] = s;
  }
  // "id-1_3_2": uma cópia do campeão, 3★, 2 itens. Só a forma de uma cópia (a de duas cópias é outra pergunta).
  for (const r of numItems) {
    const m = /^(.+)-1_(\d)_(\d)$/.exec(r.unit_tier_numitems_unique ?? ""),
      s = stat(r);
    if (m && s) unit[`${m[1]}|${m[2]}|${Math.min(3, Number(m[3]))}`] = s;
  }
  // Média do campeão (qualquer estrela) para encolher as células raras.
  const sums = new Map();
  for (const [k, [avg, n]] of Object.entries(unit)) {
    const [id, star, items] = k.split("|");
    if (star == null || items != null) continue;
    const t = sums.get(id) ?? [0, 0];
    sums.set(id, [t[0] + avg * n, t[1] + n]);
  }
  for (const [id, [w, n]] of sums)
    unit[id] = [Math.round((w / n) * 1000) / 1000, n];
  for (const r of unitItems) {
    const m = /^(.+)-1&(.+)-1$/.exec(r.unit_items_unique ?? ""),
      s = stat(r);
    if (m && s) unitItem[`${m[1]}|${m[2]}`] = s;
  }
  for (const r of traits) {
    const m = /^(.+)_(\d+)$/.exec(r.traits ?? ""),
      s = stat(r);
    if (m && s) trait[`${m[1]}|${m[2]}`] = s;
  }
  const base = stat(total[0]);
  if (!base || !Object.keys(unit).length || !Object.keys(trait).length)
    throw Error("MetaTFT não devolveu estatísticas de tabuleiro.");
  const file = {
    source:
      BASE +
      "{total,unit_tier,unit_tier_numitems_unique,unit_items_unique,traits}?" +
      METATFT_SCOPE,
    fetchedAt: new Date().toISOString(),
    set,
    patch,
    base,
    unit,
    unitItem,
    trait,
  };
  await writeFileAtomic(filePath(root), JSON.stringify(file));
  return file;
}

/** Lê a cópia local; null quando não existe ou é de outro set. */
export async function loadStats(root, set) {
  try {
    const file = JSON.parse(await fs.readFile(filePath(root), "utf8"));
    return file.set === set ? file : null;
  } catch {
    return null;
  }
}

/** A cópia precisa ser baixada de novo (ausente ou com mais de 12 h). */
export const statsAreStale = (file) =>
  !file || Date.now() - Date.parse(file.fetchedAt) > MAX_AGE_MS;
