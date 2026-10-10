// Gera augments.json: nomes (pt-BR e inglês), sinergias associadas e descrição dos aprimoramentos.
// O CommunityDragon não lista quais aprimoramentos estão ativos no set, então entram todos os conhecidos;
// a lista serve para reconhecer por nome o que aparece na tela, não para afirmar que algo está no jogo.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const english = new Map(en.map((i) => [i.apiName, i.name]));
const clean = (text) =>
  String(text ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/@[^@]*@%?/g, "X")
    .replace(/%i:[^%]*%/g, "")
    .replace(/\s+/g, " ")
    .trim();
const setOf = (id) =>
  id.startsWith("DA_") ? 99 : Number(/^TFT(\d+)_/.exec(id)?.[1] ?? 50); // DA_ = set atual; TFT_ sem número = genérico
// Aprimoramento: ID com "Augment" (sets antigos) ou ícone na pasta de aprimoramentos — no set atual a maioria
// tem ID sem a palavra (DA_SoloLeveling) e só se reconhece pelo ícone.
const augments = pt
  .filter(
    (i) =>
      (/Augment/i.test(i.apiName) || /\/augments\//i.test(i.icon ?? "")) &&
      i.name &&
      !/^@|^tft_item_name/i.test(i.name),
  )
  .map((i) => ({
    id: i.apiName,
    name: i.name,
    nameEn: english.get(i.apiName) ?? null,
    traits: i.associatedTraits ?? [],
    desc: clean(i.desc).slice(0, 260),
    set: setOf(i.apiName),
  }));
await fs.writeFile(
  path.join(root, "augments.json"),
  JSON.stringify({
    source: source + "pt_br.json + en_us.json",
    fetchedAt: new Date().toISOString(),
    augments,
  }),
);
console.log(
  JSON.stringify({
    augments: augments.length,
    currentSet: augments.filter((a) => a.set === 99).length,
  }),
);
