// Rodar com: node --test tft/helper/tests/core-items.test.mjs
// M2: a regra de itens e campeões mora em core/catalog/items.mjs e core/catalog/champions.mjs. Estes testes guardam,
// com o catálogo real, (1) que os classificadores ANTIGOS copiados sem mudança (engine.itemRole/holderRole,
// stage.kind, meta-builds, item-tiers.kindOf/baseItemId/CONSUMABLE, regex de cobertura de tactics, engine.computeRole,
// tactics.role) dão o que as funções do núcleo dão, e (2) que as ÚNICAS diferenças são as aceitas pelo usuário
// (superconjunto de papéis: 11 itens montáveis e seus radiantes; Leona), listadas aqui item a item.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CONSUMABLE,
  addCoverage,
  baseItemId,
  componentFamily,
  componentId,
  coverageOf,
  holderRole,
  isArtifact,
  isComponent,
  isConsumable,
  isEmblemItem,
  isEmblemTool,
  isManaItem,
  isPlanItem,
  isRadiant,
  isThiefsGloves,
  itemRole,
  kindOf,
  recipeMap,
  recipeOf,
  standardRecipes,
} from "../core/catalog/items.mjs";
import {
  championRole,
  isAvatar,
  poolName,
} from "../core/catalog/champions.mjs";
import { importsOf } from "./architecture/scan.mjs";
import * as viaTiers from "../item-tiers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(path.join(root, "catalog.json"), "utf8"),
);
const ids = catalog.items.map((i) => i.apiName);

/* ---------- Cópias dos classificadores antigos (sem mudança) ---------- */

/** engine.mjs: itemRole (antes do M2). */
function legacyEngineRole(id) {
  if (
    /Steadfast|SpiritVisage|Warmog|Gargoyle|Dragon|Bramble|Redemption|Sunfire|AdaptiveHelm/.test(
      id,
    )
  )
    return "tank";
  if (/InfinityEdge|Deathblade|LastWhisper|Runaans|GiantSlayer/.test(id))
    return "ad";
  if (/Rabadon|Archangel|Jeweled|VoidStaff|Nashor|Shojin|BlueBuff/.test(id))
    return "ap";
  return "flex";
}
/** engine.mjs: holderRole (antes do M2), sobre o itemRole antigo do motor. */
const legacyHolderRole = (id) =>
  /Component_/.test(id)
    ? /BFSword|RecurveBow/.test(id)
      ? "ad"
      : /NeedlesslyLargeRod|TearOfTheGoddess/.test(id)
        ? "ap"
        : /GiantsBelt|ChainVest|NegatronCloak/.test(id)
          ? "tank"
          : "flex"
    : legacyEngineRole(id);
/** stage.mjs: kind (antes do M2). */
const legacyStageKind = (id) =>
  /Gargoyle|Warmog|SpiritVisage|Crownguard|DragonsClaw|ProtectorsVow|Steadfast|Sunfire|Bramble|AdaptiveHelm|Redemption|Evenshroud/.test(
    id,
  )
    ? "tank"
    : /Rabadon|Jeweled|Archangel|VoidStaff|Nashor|Shojin|BlueBuff|Morello/.test(
          id,
        )
      ? "ap"
      : /InfinityEdge|Deathblade|LastWhisper|GiantSlayer|Kraken|Bloodthirster|EdgeOfNight|Sterak|Titans|RedBuff|Runaan/.test(
            id,
          )
        ? "ad"
        : "flex";
/** meta-builds.mjs: TANK/AP/AD (antes do M2). */
const META_TANK =
    /Gargoyle|Warmog|SpiritVisage|Crownguard|DragonsClaw|ProtectorsVow|Steadfast|Sunfire|Bramble|AdaptiveHelm|Redemption|Evenshroud/,
  META_AP =
    /Rabadon|Jeweled|Archangel|VoidStaff|Nashor|Shojin|BlueBuff|Morello/,
  META_AD =
    /InfinityEdge|Deathblade|LastWhisper|GiantSlayer|Kraken|Bloodthirster|EdgeOfNight|Sterak|Titans|HandOfJustice|RedBuff|Runaan/;
const legacyMetaRole = (id) =>
  META_TANK.test(id)
    ? "tank"
    : META_AP.test(id)
      ? "ap"
      : META_AD.test(id)
        ? "ad"
        : "flex";
/** item-tiers.mjs: kindOf (antes do M2). */
function legacyKindOf(id, from = []) {
  if (id.startsWith("DA_Component_")) return "component";
  if (/Potion|Upgrade|Radiantize|Artifactinate|Chest/i.test(id)) return "other";
  if (/_?Radiant$/.test(id)) return "radiant";
  if (/^DA_(Item_)?Artifact_/.test(id)) return "artifact";
  if (/Emblem/i.test(id)) return "emblem";
  if (from.length === 2 && from.every((c) => c.startsWith("DA_Component_")))
    return "completed";
  return "other";
}
/** tactics.mjs: cobertura (antes do M2): as três linhas que se repetiam em 4 lugares. */
function legacyCoverage(id) {
  const out = [];
  if (/VoidStaff/.test(id)) out.push("shredMagic");
  if (/LastWhisper/.test(id)) out.push("shredArmor");
  if (/SunfireCape|Morellonomicon|RedBuff/.test(id)) out.push("wounds");
  return out;
}
/** engine.computeRole e tactics.role (antes do M2), com `metaRoles` opcional. */
function legacyEngineChampionRole(c, metaRoles) {
  const known = metaRoles?.get(c.apiName);
  if (known) return known;
  const desc = (c.ability?.desc ?? "").toLowerCase();
  if (c.stats.range <= 2 && /shield|health|heal|durability|resist/.test(desc))
    return "tank";
  return /physical damage/.test(desc) && !/magic damage/.test(desc)
    ? "ad"
    : "ap";
}
function legacyTacticsChampionRole(c, metaRoles) {
  const known = metaRoles?.get(c.apiName);
  if (known) return known;
  const d = (c.ability?.desc ?? "").toLowerCase();
  if (c.stats.range <= 2 && /shield|heal|health|durability/.test(d))
    return "tank";
  return /physical damage/.test(d) && !/magic damage/.test(d) ? "ad" : "ap";
}

/** Os 11 itens montáveis (receita de 2 componentes) que o motor tratava como `flex` e os outros classificadores não. */
const ELEVEN = [
  "DA_RedBuff",
  "DA_Evenshroud",
  "DA_Morellonomicon",
  "DA_ProtectorsVow",
  "DA_EdgeOfNight",
  "DA_TitansResolve",
  "DA_HandOfJustice",
  "DA_Bloodthirster",
  "DA_Crownguard",
  "DA_SteraksGage",
  "DA_KrakensFury",
];
/** Papel de cada um dos 11 no superconjunto (o que `stage.kind` e `meta-builds` já davam; HandOfJustice: AD de meta-builds). */
const ELEVEN_ROLE = {
  DA_RedBuff: "ad",
  DA_Evenshroud: "tank",
  DA_Morellonomicon: "ap",
  DA_ProtectorsVow: "tank",
  DA_EdgeOfNight: "ad",
  DA_TitansResolve: "ad",
  DA_HandOfJustice: "ad",
  DA_Bloodthirster: "ad",
  DA_Crownguard: "tank",
  DA_SteraksGage: "ad",
  DA_KrakensFury: "ad",
};

/* ---------- Papel do item ---------- */

test("papel do item = meta-builds em todo o catálogo (a união já era a lista de meta-builds)", () => {
  for (const id of ids) assert.equal(itemRole(id), legacyMetaRole(id), id);
});

test("papel do item vs stage.kind: só HandOfJustice (e o radiante) mudam, de flex para ad", () => {
  const diff = ids.filter((id) => itemRole(id) !== legacyStageKind(id));
  assert.deepEqual(
    diff.map((id) => baseItemId(id)),
    diff.map(() => "DA_HandOfJustice"),
    diff.join(","),
  );
  assert.ok(diff.length >= 1);
  for (const id of diff) {
    assert.equal(legacyStageKind(id), "flex", id);
    assert.equal(itemRole(id), "ad", id);
  }
});

test("papel do item vs engine.itemRole: o motor só ganha papel onde era flex (11 itens montáveis e seus radiantes)", () => {
  const diff = ids.filter((id) => itemRole(id) !== legacyEngineRole(id));
  for (const id of diff) {
    assert.equal(
      legacyEngineRole(id),
      "flex",
      `${id}: o motor nunca contradizia, só omitia`,
    );
    assert.notEqual(itemRole(id), "flex", id);
  }
  // Os montáveis (2 componentes, não radiantes) que mudam são exatamente os 11 documentados, com o papel esperado.
  const montaveis = diff.filter(
    (id) =>
      !isRadiant(id) && recipeOf(catalog.items.find((i) => i.apiName === id)),
  );
  assert.deepEqual([...montaveis].sort(), [...ELEVEN].sort());
  for (const id of ELEVEN) assert.equal(itemRole(id), ELEVEN_ROLE[id], id);
  // Todo radiante que muda tem o item base entre os 11.
  for (const id of diff.filter(isRadiant))
    assert.ok(ELEVEN.includes(baseItemId(id)), id);
  // Nada que o motor já classificava mudou.
  for (const id of ids)
    if (legacyEngineRole(id) !== "flex")
      assert.equal(itemRole(id), legacyEngineRole(id), id);
});

test("holderRole: componentes iguais ao motor antigo; itens prontos seguem o papel único", () => {
  for (const id of ids)
    if (isComponent(id)) assert.equal(holderRole(id), legacyHolderRole(id), id);
    else assert.equal(holderRole(id), itemRole(id), id);
  assert.equal(holderRole("DA_Component_RecurveBow"), "ad");
  assert.equal(holderRole("DA_Component_Spatula"), "flex");
});

test("componentFamily: separa o arco (AD com um pouco de AP) dos demais", () => {
  assert.equal(componentFamily("DA_Component_BFSword"), "ad");
  assert.equal(componentFamily("DA_Component_NeedlesslyLargeRod"), "ap");
  assert.equal(componentFamily("DA_Component_TearOfTheGoddess"), "ap");
  assert.equal(componentFamily("DA_Component_RecurveBow"), "bow");
  for (const t of ["GiantsBelt", "ChainVest", "NegatronCloak"])
    assert.equal(componentFamily("DA_Component_" + t), "tank");
  assert.equal(componentFamily("DA_Component_SparringGloves"), "flex");
  assert.equal(componentFamily("DA_InfinityEdge"), "flex");
});

/* ---------- Identidade, tipo e consumíveis ---------- */

test("kindOf, baseItemId, isConsumable e isComponent iguais aos de antes em todo o catálogo", () => {
  for (const i of catalog.items) {
    const id = i.apiName;
    assert.equal(
      kindOf(id, i.composition ?? []),
      legacyKindOf(id, i.composition ?? []),
      id,
    );
    assert.equal(baseItemId(id), id.replace(/_?Radiant$/, ""), id);
    assert.equal(isConsumable(id), CONSUMABLE.test(id), id);
    assert.equal(isComponent(id), id.startsWith("DA_Component_"), id);
    assert.equal(isComponent(id), /Component_/.test(id), id);
    assert.equal(isEmblemItem(id), /Emblem/.test(id), id);
    assert.equal(isThiefsGloves(id), /ThiefsGloves/.test(id), id);
    assert.equal(isManaItem(id), /BlueBuff|SpearOfShojin/.test(id), id);
    assert.equal(
      isEmblemTool(id),
      /Component_(Spatula|FryingPan)/.test(id),
      id,
    );
    assert.equal(isArtifact(id), /^DA_(Item_)?Artifact_/.test(id), id);
  }
});

test("isPlanItem igual ao de item-value.mjs antes do M2", () => {
  const legacy = (id) =>
    /^DA_/.test(id ?? "") &&
    !/Component|Emblem|Artifact|Consumable|Spatula|FryingPan|Upgrade/.test(id);
  for (const id of [...ids, "", undefined, null, "TFT_Item_X"])
    assert.equal(isPlanItem(id), legacy(id), String(id));
});

test("item-tiers.mjs reexporta as mesmas funções do núcleo", () => {
  assert.equal(viaTiers.kindOf, kindOf);
  assert.equal(viaTiers.baseItemId, baseItemId);
  assert.equal(viaTiers.isConsumable, isConsumable);
  assert.equal(viaTiers.CONSUMABLE, CONSUMABLE);
});

test("tolera valores ausentes sem lançar", () => {
  assert.equal(isConsumable(undefined), false);
  assert.equal(isComponent(null), false);
  assert.equal(baseItemId(undefined), "");
  assert.equal(itemRole(undefined), "flex");
  assert.deepEqual(coverageOf(undefined), []);
  assert.equal(componentId("BFSword"), "DA_Component_BFSword");
  assert.ok(isComponent(componentId("Spatula")));
});

/* ---------- Receitas ---------- */

test("recipeOf/recipeMap/standardRecipes iguais aos filtros que existiam no motor e no plano", () => {
  const legacyMap = new Map(
    catalog.items
      .filter((i) => i.composition?.length === 2)
      .map((i) => [i.apiName, i.composition]),
  );
  assert.deepEqual([...recipeMap(catalog.items)], [...legacyMap]);
  const legacyPlan = new Map(
    catalog.items
      .filter((i) => i.composition?.length === 2 && isPlanItem(i.apiName))
      .map((i) => [i.apiName, i.composition]),
  );
  assert.deepEqual(
    [...recipeMap(catalog.items, (i) => isPlanItem(i.apiName))],
    [...legacyPlan],
  );
  const legacyReady = catalog.items.filter(
    (i) =>
      i.apiName.startsWith("DA_") &&
      i.composition?.length === 2 &&
      !/Emblem|Radiant/.test(i.apiName),
  );
  assert.deepEqual(
    standardRecipes(catalog.items).map((i) => i.apiName),
    legacyReady.map((i) => i.apiName),
  );
  assert.equal(recipeOf(undefined), null);
  assert.equal(recipeOf({ composition: ["a"] }), null);
});

/* ---------- Cobertura ---------- */

test("cobertura igual às linhas que se repetiam em tactics", () => {
  for (const id of ids)
    assert.deepEqual(coverageOf(id), legacyCoverage(id), id);
  assert.deepEqual(coverageOf("DA_VoidStaff"), ["shredMagic"]);
  assert.deepEqual(coverageOf("DA_LastWhisper"), ["shredArmor"]);
  for (const id of ["DA_SunfireCape", "DA_Morellonomicon", "DA_RedBuff"])
    assert.deepEqual(coverageOf(id), ["wounds"], id);
  const set = addCoverage(new Set(), [
    "DA_VoidStaff",
    "DA_Component_BFSword",
    "DA_RedBuff",
  ]);
  assert.deepEqual([...set].sort(), ["shredMagic", "wounds"]);
  assert.equal(addCoverage(set, undefined), set);
});

/* ---------- Campeões ---------- */

test("papel do campeão: igual ao do motor; o do plano mudava só na Leona (ap -> tank)", () => {
  const champions = catalog.champions;
  for (const c of champions)
    assert.equal(championRole(c), legacyEngineChampionRole(c), c.apiName);
  const diff = champions.filter(
    (c) => championRole(c) !== legacyTacticsChampionRole(c),
  );
  assert.deepEqual(
    diff.map(
      (c) => `${c.apiName}:${legacyTacticsChampionRole(c)}->${championRole(c)}`,
    ),
    ["DA_18_Leona:ap->tank"],
  );
});

test("papel do campeão: o papel da meta vale primeiro", () => {
  const leona = catalog.champions.find((c) => c.apiName === "DA_18_Leona");
  assert.equal(championRole(leona, new Map([["DA_18_Leona", "ap"]])), "ap");
  assert.equal(championRole(leona, new Map()), "tank");
  assert.equal(championRole(leona, null), "tank");
});

test("Avatar e nome na pool", () => {
  const avatars = catalog.champions.filter(isAvatar);
  assert.ok(avatars.length >= 1);
  for (const c of catalog.champions) {
    assert.equal(isAvatar(c), c.traits.includes("Avatar"), c.apiName);
    assert.equal(poolName(c), c.traits.includes("Avatar") ? "Lux" : c.name);
  }
  assert.equal(isAvatar(undefined), false);
});

/* ---------- Pureza ---------- */

test("o catálogo de itens e o de campeões não importam nada (carregam igual no navegador)", () => {
  assert.deepEqual(importsOf("core/catalog/items.mjs"), []);
  assert.deepEqual(importsOf("core/catalog/champions.mjs"), []);
});
