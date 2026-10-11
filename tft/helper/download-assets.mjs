import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
const root = path.dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "catalog.json"), "utf8"),
);
// Wisps (build-wisps.mjs): todos usam o mesmo ícone de mecânica do Set 18; uma entrada por ícone, com o prefixo "wisp:".
const wisps = await fs
  .readFile(path.join(root, "wisps.json"), "utf8")
  .then((text) => JSON.parse(text).wisps ?? [])
  .catch(() => []);
await fs.mkdir(path.join(root, "assets"), { recursive: true });
const manifest = {};
const items = catalog.items.filter(
  (i) =>
    i.icon &&
    (i.apiName.startsWith("DA_Component_") ||
      i.composition?.length === 2 ||
      // Tudo o que pode ocupar o banco de itens: o leitor de tela compara cada espaço com estes ícones.
      /Radiant|ThiefsGloves|Consumable_|Reforger|Artifact|Emblem|Potion|Booster|Masterwork|LuckyItemChest/.test(
        i.apiName,
      )),
);
const queue = [
  ...catalog.champions.map((c) => ({
    id: c.apiName,
    icon: c.squareIcon ?? c.icon,
  })),
  ...items.map((i) => ({ id: i.apiName, icon: i.icon })),
  // Sinergias: prefixo próprio no manifesto para nunca colidir com o id de um campeão ou item.
  ...catalog.traits.map((t) => ({ id: "trait:" + t.apiName, icon: t.icon })),
  ...[...new Map(wisps.map((w) => [w.iconKey, w.icon]))].map(([id, icon]) => ({
    id,
    icon,
  })),
];
let ok = 0,
  failed = 0;
async function worker() {
  while (queue.length) {
    const entry = queue.shift();
    if (!entry.icon || entry.icon === "None") {
      failed++;
      continue;
    }
    const file =
      crypto
        .createHash("sha256")
        .update(entry.icon)
        .digest("hex")
        .slice(0, 24) + ".png";
    const target = path.join(root, "assets", file);
    try {
      await fs.access(target);
    } catch {
      const url =
        "https://raw.communitydragon.org/latest/game/" +
        entry.icon.toLowerCase().replace(/\.tex$/, ".png");
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!r.ok || !r.headers.get("content-type")?.startsWith("image/")) {
          failed++;
          continue;
        }
        await fs.writeFile(target, Buffer.from(await r.arrayBuffer()));
      } catch {
        failed++;
        continue;
      }
    }
    manifest[entry.id] = "/assets/" + file;
    ok++;
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
await fs.writeFile(
  path.join(root, "assets-manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(JSON.stringify({ downloaded: ok, failed }));
