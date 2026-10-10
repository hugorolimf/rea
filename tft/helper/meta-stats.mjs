// Estatísticas de colocação medidas pela MetaTFT (explorer, endpoints não oficiais): colocação média e número
// de partidas por campeão × estrela × quantidade de itens, por campeão × item e por sinergia × patamar.
// Servem para escolher os trunfos (suas peças com estrela e itens de melhor colocação medida) e o emblema que
// mais rende; os tabuleiros inteiros são medidos pelo explorer (evidence.mjs). O servidor guarda uma cópia local com origem/data e segue com ela se a rede falhar.
import fs from "node:fs/promises";
import path from "node:path";

const BASE = "https://api-hc.metatft.com/tft-explorer-api/";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const filePath = (root) => path.join(root, "meta-stats.json");

const stat = (r) =>
  Number.isFinite(r?.avg_placement) && r.total_games > 0
    ? [Math.round(r.avg_placement * 1000) / 1000, r.total_games]
    : null;

async function get(name) {
  const response = await fetch(BASE + name, {
    signal: AbortSignal.timeout(40000),
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
export async function refreshStats(root, set) {
  const [total, tiers, numItems, unitItems, traits] = await Promise.all([
    get("total"),
    get("unit_tier"),
    get("unit_tier_numitems_unique"),
    get("unit_items_unique"),
    get("traits"),
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
      "{total,unit_tier,unit_tier_numitems_unique,unit_items_unique,traits}",
    fetchedAt: new Date().toISOString(),
    set,
    base,
    unit,
    unitItem,
    trait,
  };
  await fs.writeFile(filePath(root), JSON.stringify(file));
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
