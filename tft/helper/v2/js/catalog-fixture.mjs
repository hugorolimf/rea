// Catálogo da interface montado como o servidor entrega em /api/catalog (server.mjs) e a api.js carrega:
// campeões, itens (com receita, tipo e ícone do manifesto de ativos) e sinergias. Só para testes.
import { readFileSync } from "node:fs";
import { isConsumable, kindOf } from "../../item-tiers.mjs";

const read = (f) =>
  JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8"));

/** Catálogo real do set (catalog.json + assets-manifest.json) no formato que `setCatalog` espera. */
export function realCatalog() {
  const raw = read("../../catalog.json"),
    icons = read("../../assets-manifest.json");
  const items = raw.items.map((i) => ({
    id: i.apiName,
    name: i.name,
    composition: i.composition ?? [],
    icon: icons[i.apiName] ?? null,
    kind: kindOf(i.apiName, i.composition ?? []),
    consumable: isConsumable(i.apiName),
  }));
  return {
    champions: new Map(
      raw.champions.map((c) => [
        c.apiName,
        {
          id: c.apiName,
          name: c.name,
          cost: c.cost,
          icon: icons[c.apiName] ?? null,
          traits: c.traits,
        },
      ]),
    ),
    items: new Map(items.map((i) => [i.id, i])),
    traits: new Map(
      raw.traits.map((t) => [t.name, t.effects.map((e) => e.minUnits)]),
    ),
    traitIcons: new Map(
      raw.traits.map((t) => [t.name, icons["trait:" + t.apiName] ?? null]),
    ),
    emblems: new Map(),
  };
}

/** Catálogo pequeno e controlado para casos de colisão e escape. */
export function tinyCatalog() {
  const champ = (id, name, cost = 1, icon = `/assets/${id}.png`) => [
    id,
    { id, name, cost, icon, traits: [] },
  ];
  const item = (id, name, over = {}) => [
    id,
    {
      id,
      name,
      composition: [],
      icon: `/assets/${id}.png`,
      kind: "completed",
      ...over,
    },
  ];
  return {
    champions: new Map([
      champ("C_Teemo", "Teemo", 1),
      champ("C_Vi", "Vi", 3),
      champ("C_Blade", "Blade", 2),
      champ("C_Vanguard", "Vanguard", 4),
      champ("C_Sentry", "Pebbles", 1),
      champ("C_NoIcon", "Poppy", 1, null),
      champ("C_Rek", "Rek'Sai", 2),
      champ("C_Evil", "<b>Evil</b>", 2),
    ]),
    items: new Map([
      item("I_Sun", "Sunfire Cape"),
      item("I_Sunfire", "Sunfire"),
      item("I_Vest", "Chain Vest", { kind: "component" }),
      item("I_Dup", "Twin"),
      item("I_Dup_Upgrade", "Twin"),
      item("I_Rune", "Vi", { kind: "completed" }),
      // Aprimoramento: sem ícone e do tipo "other" (só bloqueia).
      item("I_Aug", "Phantom Armor", { icon: null, kind: "other" }),
      item("I_Phantom", "Phantom", { kind: "completed" }),
    ]),
    traits: new Map([
      ["Vanguard", [2, 4]],
      ["Blade Master", [2]],
      ["Rival", [2]],
    ]),
    traitIcons: new Map(),
    emblems: new Map(),
  };
}
