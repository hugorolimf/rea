// Dados de aprimoramento de duas fontes (não oficiais), com cópia local e origem/data:
// - NoxuTFT (https://noxutft.com/tft-augments): colocação média medida por aprimoramento, geral e por rodada em
//   que foi escolhido (2-1, 3-2, 4-2), top 4 e partidas. Amostras pequenas (dezenas a poucos milhares).
// - MetaTFT (comp_augment_tiers): tier S–D de cada aprimoramento para cada comp, montado por especialistas; o
//   próprio site converte o tier em ajuste de colocação (TIER_PLACE), e é essa a régua usada aqui.
// A MetaTFT não publica colocação medida por aprimoramento neste set (o campo vem vazio).
import fs from "node:fs/promises";
import path from "node:path";

const NOXU = "https://noxutft.com/tft-augments";
const TIERS = "https://api-hc.metatft.com/tft-comps-api/comp_augment_tiers";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Ajuste de colocação por tier, como a MetaTFT aplica no próprio site. */
export const TIER_PLACE = { S: -0.3, A: -0.15, B: 0, C: 0.15, D: 0.3 };
const filePath = (root) => path.join(root, "augment-stats.json");

const num = (v) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};

/** Lê a tabela da NoxuTFT: uma linha <tr data-row> por aprimoramento, números nos atributos data-s-*. */
export function parseNoxu(html) {
  const out = {};
  for (const m of html.matchAll(/<tr data-row([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const attrs = m[1],
      id = /data-tt="aug:([^"]+)"/.exec(m[2])?.[1];
    if (!id) continue;
    const a = (k) => num(new RegExp(`data-s-${k}="([^"]*)"`).exec(attrs)?.[1]);
    const games = Math.abs(a("games") ?? 0);
    if (!games) continue;
    out[id] = {
      avg: a("place"),
      games,
      top4: a("top4") == null ? null : Math.abs(a("top4")),
      at: { "2-1": a("at21"), "3-2": a("at32"), "4-2": a("at42") },
    };
  }
  return out;
}

/** Baixa as duas fontes e regrava a cópia local; mantém a parte que falhar da cópia anterior. */
export async function refreshAugmentStats(root) {
  const prev = await loadAugmentStats(root);
  const [noxu, tiers] = await Promise.allSettled([
    fetch(NOXU, {
      signal: AbortSignal.timeout(30000),
      headers: { "User-Agent": "tft-helper (local)" },
    }).then(async (r) => {
      if (!r.ok) throw Error("NoxuTFT respondeu " + r.status);
      const parsed = parseNoxu(await r.text());
      if (Object.keys(parsed).length < 20)
        throw Error("NoxuTFT: tabela não reconhecida");
      return parsed;
    }),
    fetch(TIERS, { signal: AbortSignal.timeout(30000) }).then(async (r) => {
      if (!r.ok) throw Error("MetaTFT respondeu " + r.status);
      const out = {};
      for (const [cluster, v] of Object.entries((await r.json()).results ?? {}))
        out[cluster] = Object.fromEntries(
          (v.augments ?? []).map((x) => [x.id, x.tier]),
        );
      if (!Object.keys(out).length) throw Error("MetaTFT: sem tiers");
      return out;
    }),
  ]);
  if (noxu.status === "rejected" && tiers.status === "rejected")
    throw Error(`${noxu.reason.message}; ${tiers.reason.message}`);
  const file = {
    sources: { measured: NOXU, tiers: TIERS },
    fetchedAt: new Date().toISOString(),
    augments: noxu.status === "fulfilled" ? noxu.value : (prev?.augments ?? {}),
    compTiers:
      tiers.status === "fulfilled" ? tiers.value : (prev?.compTiers ?? {}),
  };
  await fs.writeFile(filePath(root), JSON.stringify(file));
  return file;
}

/** Lê a cópia local; null quando não existe. */
export async function loadAugmentStats(root) {
  try {
    return JSON.parse(await fs.readFile(filePath(root), "utf8"));
  } catch {
    return null;
  }
}

/** A cópia precisa ser baixada de novo (ausente ou com mais de 6 h). */
export const augmentStatsAreStale = (file) =>
  !file || Date.now() - Date.parse(file.fetchedAt) > MAX_AGE_MS;
