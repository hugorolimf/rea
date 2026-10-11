// Gera items.json: itens do set atual (prefixo DA_) com nome em pt-BR e inglês, tipo, receita, atributos e
// descrição em pt-BR com os valores preenchidos. Os itens DA_ do CommunityDragon vêm sem efeitos; os números
// e o texto saem do item "gêmeo" genérico (TFT_Item_*, TFT5_Item_*Radiant, TFT_Item_Artifact_*).
// Rodar: node tft/helper/build-items.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStats, renderDesc } from "./item-tiers.mjs";
import { kindOf } from "./core/catalog/items.mjs";

const root = path.dirname(fileURLToPath(import.meta.url)),
  source = "https://raw.communitydragon.org/latest/cdragon/tft/";
const get = async (locale) => {
  const r = await fetch(source + locale + ".json", {
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw Error(locale + " HTTP " + r.status);
  return (await r.json()).items;
};
const [pt, en] = await Promise.all([get("pt_br"), get("en_us")]);
const byApi = new Map(pt.map((i) => [i.apiName, i])),
  english = new Map(en.map((i) => [i.apiName, i.name]));
const hasData = (i) => i && (Object.keys(i.effects ?? {}).length || i.desc);

/** Item genérico com os números e o texto de um item DA_ do set atual. */
function twinOf(id) {
  const base = id.replace(/^DA_/, "");
  const tries = [
    `TFT_Item_${base}`,
    `TFT_Item_${base.replace(/^Component_/, "")}`,
    `TFT5_Item_${base.replace(/_?Radiant$/, "")}Radiant`,
    `TFT_Item_${base.replace(/^Item_/, "")}`,
  ];
  for (const t of tries) if (hasData(byApi.get(t))) return byApi.get(t);
  // Último recurso: mesmo nome em inglês, item genérico com efeitos (nunca tutorial ou "corrompido").
  const name = english.get(id);
  // Preferência: TFT_Item_* genérico, depois TFT<set>_Item_*; eventos, assistentes e aprimoramentos nunca.
  const rank = (api) =>
    api.startsWith("TFT_Item_") ? 0 : /^TFT\d+_Item_/.test(api) ? 1 : 2;
  return (
    en
      .filter(
        (i) =>
          i.name === name &&
          !i.apiName.startsWith("DA_") &&
          !/Tutorial|Corrupted|Augment|Encounter|Assist/.test(i.apiName) &&
          Object.keys(i.effects ?? {}).length,
      )
      .sort((x, y) => rank(x.apiName) - rank(y.apiName))
      .map((i) => byApi.get(i.apiName))
      .find(Boolean) ?? null
  );
}

const items = [];
for (const item of pt) {
  const id = item.apiName;
  if (!id.startsWith("DA_") || item.isAugment) continue;
  const kind = kindOf(id, item.composition ?? []);
  const twin = twinOf(id),
    effects = { ...twin?.effects, ...item.effects };
  const name =
    item.name && !/^@|tft_item_name/i.test(item.name)
      ? item.name
      : (twin?.name ?? null);
  if (!name) continue;
  // Emblemas do set não trazem texto: o efeito é a sinergia do nome ("Emblema de Lunar" → Lunar).
  const trait =
    kind === "emblem"
      ? (/^Emblema d[eao]s? (.+)$/i.exec(name)?.[1] ?? null)
      : null;
  items.push({
    id,
    name,
    nameEn: english.get(id) ?? null,
    kind,
    from: item.composition ?? [],
    traits: item.associatedTraits ?? [],
    unique: !!item.unique,
    stats: normalizeStats(effects),
    trait,
    desc:
      renderDesc(item.desc || twin?.desc || "", effects) ||
      (trait ? `Quem equipa ganha a sinergia ${trait}.` : ""),
    twin: twin?.apiName ?? null,
  });
}
await fs.writeFile(
  path.join(root, "items.json"),
  JSON.stringify({
    source: source + "pt_br.json + en_us.json",
    fetchedAt: new Date().toISOString(),
    items,
  }),
);
const count = {};
for (const i of items) count[i.kind] = (count[i.kind] ?? 0) + 1;
console.log(JSON.stringify({ items: items.length, ...count }));
