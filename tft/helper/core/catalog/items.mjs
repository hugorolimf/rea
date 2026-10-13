/**
 * Catálogo de itens: a regra única do helper para "que tipo de item é este" (M2 da migração, ver ARQUITETURA.md).
 *
 * Reúne o que `engine.itemRole/holderRole`, `stage.kind`, `meta-builds.TANK/AP/AD`, `item-tiers.kindOf/CONSUMABLE/
 * baseItemId`, as regex de cobertura de `tactics` e as cópias de `isComponent`/receita escreviam cada um por conta
 * própria. ESM puro: carrega igual no servidor e no navegador (nada de `node:*`, relógio ou aleatório).
 *
 * O PAPEL do item é o superconjunto dos três classificadores que existiam (decisão do usuário, 2026-10-10): o motor
 * tratava como `flex` 11 itens montáveis que `stage` e `meta-builds` já davam como AD/AP/tanque, e `stage` deixava
 * `HandOfJustice` como `flex` enquanto `meta-builds` o dava como AD. A lista de cada papel abaixo é a união das três.
 */

/* ---------- identidade do item (por id) ---------- */

/**
 * Consumíveis ocupam espaço no banco, mas não são itens para montar nem equipar (Removedor, Duplicadores, Reforjador,
 * Poções, Boosters, Melhoria do Mestre-Artesão, Baú da Sorte): ficam fora de toda análise de itens.
 */
export const CONSUMABLE =
  /Consumable_|Reforger|Potion|Booster|Masterwork|LuckyItemChest|Anvil/;
export const isConsumable = (id) => CONSUMABLE.test(id ?? "");

/**
 * Bigorna no banco (GEP: `DA_AnvilComponent`, `DA_AnvilCompletedItems`, `DA_AnvilArtifact`, `DA_Peddler18_*Anvil`): abre
 * uma escolha de componente (`"component"`), de item completo (`"completed"`) ou de artefato (`"artifact"`); null se não é
 * bigorna. Fica fora das análises comuns de item (é consumível acima); só a prioridade de itens a usa
 * (core/items/item-priority.mjs).
 */
export function anvilKind(id) {
  const s = String(id ?? "");
  if (!/Anvil/.test(s)) return null;
  if (/Artifact|Ornn/.test(s)) return "artifact";
  if (/Component/.test(s)) return "component";
  return "completed";
}

const COMPONENT_PREFIX = "DA_Component_";

/** Componente básico (BF Sword, Recurve Bow, Espátula...): `DA_Component_*`. */
export const isComponent = (id) =>
  String(id ?? "").startsWith(COMPONENT_PREFIX);

/** Id do componente pelo nome curto ("BFSword" vira "DA_Component_BFSword"). */
export const componentId = (name) => COMPONENT_PREFIX + name;

/** Id do item base de um radiante ("DA_TitansResolve_Radiant" e "DA_VoidStaffRadiant" viram o item comum). */
export const baseItemId = (id) => String(id ?? "").replace(/_?Radiant$/, "");

/** Versão radiante de um item (o id termina em `Radiant` ou `_Radiant`). */
export const isRadiant = (id) => /_?Radiant$/.test(id ?? "");

/** Artefato (bigorna): `DA_Artifact_*` ou `DA_Item_Artifact_*`. */
export const isArtifact = (id) => /^DA_(Item_)?Artifact_/.test(id ?? "");

/** Item de emblema (qualquer `...Emblem...`); a sinergia que ele dá está em `core/catalog/traits.mjs`. */
export const isEmblemItem = (id) => /Emblem/.test(id ?? "");

/** Espátula e Frigideira: os componentes que formam emblemas. */
export const isEmblemTool = (id) =>
  /Component_(Spatula|FryingPan)/.test(id ?? "");

/** Luva do Ladrão: ocupa os três espaços da peça e sorteia os itens, então não se planeja em volta dela. */
export const isThiefsGloves = (id) => /ThiefsGloves/.test(id ?? "");

/**
 * Item exclusivo de mana: Azul Buff e Lança de Shojin dão o mesmo efeito, então a peça leva só um dos dois.
 */
export const isManaItem = (id) => /BlueBuff|SpearOfShojin/.test(id ?? "");

/**
 * Item que entra no plano de itens: completo e equipável (fora componentes, emblemas, artefatos, consumíveis e
 * ferramentas de emblema).
 */
export const isPlanItem = (id) =>
  /^DA_/.test(id ?? "") &&
  !/Component|Emblem|Artifact|Consumable|Spatula|FryingPan|Upgrade|Anvil/.test(
    id,
  );

/**
 * Tipo do item pelo id do set atual e pela receita (`from` = ids dos componentes): componente, radiante, artefato,
 * emblema, completo (2 componentes) ou outro.
 */
export function kindOf(id, from = []) {
  if (isComponent(id)) return "component";
  // Itens de aprimoramento e consumíveis também têm "Radiant"/"Artifact" no nome; só contam os itens de fato.
  if (/Potion|Upgrade|Radiantize|Artifactinate|Chest/i.test(id)) return "other";
  if (isRadiant(id)) return "radiant";
  if (isArtifact(id)) return "artifact";
  if (/Emblem/i.test(id)) return "emblem";
  if (from.length === 2 && from.every(isComponent)) return "completed";
  return "other";
}

/* ---------- receitas ---------- */

/** Receita montável do item do catálogo: os 2 componentes, ou `null` (artefato, radiante, componente, emblema pronto). */
export const recipeOf = (item) =>
  item?.composition?.length === 2 ? item.composition : null;

/** Mapa id → [componente, componente] dos itens do catálogo que se montam, opcionalmente só os que passam em `keep`. */
export const recipeMap = (items, keep = () => true) =>
  new Map(
    (items ?? [])
      .filter((i) => recipeOf(i) && keep(i))
      .map((i) => [i.apiName, i.composition]),
  );

/** Itens comuns montáveis (sem emblema nem radiante): as receitas que o banco pode fechar. */
export const standardRecipes = (items) =>
  (items ?? []).filter(
    (i) =>
      (i.apiName ?? "").startsWith("DA_") &&
      recipeOf(i) &&
      !/Emblem|Radiant/.test(i.apiName),
  );

/* ---------- papel ---------- */

/**
 * Papel de cada item completo: o portador que mais o usa. União dos classificadores antigos do motor, do plano
 * (`stage.kind`) e da meta (`meta-builds`); a ordem de teste é tanque, AP, AD (nenhum id do catálogo casa dois).
 */
const ROLE_TANK =
  /Gargoyle|Warmog|SpiritVisage|Crownguard|DragonsClaw|ProtectorsVow|Steadfast|Sunfire|Bramble|AdaptiveHelm|Redemption|Evenshroud/;
const ROLE_AP =
  /Rabadon|Jeweled|Archangel|VoidStaff|Nashor|Shojin|BlueBuff|Morello/;
const ROLE_AD =
  /InfinityEdge|Deathblade|LastWhisper|GiantSlayer|Kraken|Bloodthirster|EdgeOfNight|Sterak|Titans|HandOfJustice|RedBuff|Runaan/;

/** "tank" | "ap" | "ad" | "flex" (serve a qualquer portador; também componentes e itens desconhecidos). */
export function itemRole(id) {
  const s = id ?? "";
  if (ROLE_TANK.test(s)) return "tank";
  if (ROLE_AP.test(s)) return "ap";
  if (ROLE_AD.test(s)) return "ad";
  return "flex";
}

/**
 * Família do componente: "ad" (BF Sword), "ap" (Vara, Lágrima), "bow" (Arco Recurvo: AD com um pouco de AP), "tank"
 * (Cinturão, Colete, Capa) ou "flex" (os demais, incluindo Espátula e Frigideira).
 */
export function componentFamily(id) {
  const s = id ?? "";
  if (/BFSword/.test(s)) return "ad";
  if (/NeedlesslyLargeRod|TearOfTheGoddess/.test(s)) return "ap";
  if (/RecurveBow/.test(s)) return "bow";
  if (/GiantsBelt|ChainVest|NegatronCloak/.test(s)) return "tank";
  return "flex";
}

/** Papel de um portador para um item qualquer: o do componente pela família (arco conta como AD) ou o do item pronto. */
export function holderRole(id) {
  if (!isComponent(id)) return itemRole(id);
  const family = componentFamily(id);
  return family === "bow" ? "ad" : family;
}

/* ---------- cobertura ---------- */

/** Efeitos que a comp precisa ter pelo menos uma vez: item que os dá (por id, radiante incluído). */
const COVERAGE = [
  ["shredMagic", /VoidStaff/],
  ["shredArmor", /LastWhisper/],
  ["wounds", /SunfireCape|Morellonomicon|RedBuff/],
];

/** Efeitos de cobertura que o item dá: lista de "shredMagic" | "shredArmor" | "wounds" (vazia se nenhum). */
export const coverageOf = (id) =>
  COVERAGE.filter(([, re]) => re.test(id ?? "")).map(([tag]) => tag);

/** Soma ao conjunto `into` os efeitos de cobertura dos itens `ids`. Devolve o próprio conjunto. */
export function addCoverage(into, ids) {
  for (const id of ids ?? []) for (const tag of coverageOf(id)) into.add(tag);
  return into;
}
