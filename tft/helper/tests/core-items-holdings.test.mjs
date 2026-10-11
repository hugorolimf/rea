// Rodar com: node --test tft/helper/tests/core-items-holdings.test.mjs
// M6: a posse de itens mora em core/items/ (stock, holdings, bank, moves, owned). Estes testes guardam, em cenários
// SORTEADOS (semente fixa), que o núcleo dá o que as implementações ANTIGAS dão, copiadas aqui sem mudança:
//   - v2/js/item-source.js (locateItem, ownersOf) e item-holdings.mjs (resolveHoldings);
//   - v2/js/comp-items.js (compItems: banco entre as builds, emblemas, metade de receita);
//   - v2/js/next-item.js (nextItemRecipe);
//   - os laços de estoque de tactics.mjs (build, synergyTips, ownedItemAdvice), engine.mjs (readyRecipes), item-edge.mjs
//     (caminho sem localização), carousel.mjs;
//   - os laços de "passar itens" de tactics (coveredByMoves), stage (movedIn), plan-progress (moved) e model.js (moves);
//   - a situação por origem de item-plan.mjs e a cadeia de status de plan-progress.mjs.
// E o teste T4 da seção 3.3: Formação = motor = aba Comps no mesmo estado (banco).
// Diferenças aceitas e conhecidas (ver ARQUITETURA.md, seção M6): o núcleo gasta a cópia EXATA do banco antes do
// radiante (o antigo `takeBase` gastava a primeira que casasse); a classificação não muda com isso.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  baseItemId,
  isComponent,
  isEmblemTool,
  standardRecipes,
} from "../core/catalog/items.mjs";
import {
  AVAILABLE_KINDS,
  HOLD_KINDS,
  buildStates,
  classifyHoldings,
  craftKindFromOrigins,
  kindFromOrigin,
  locateItem,
  ownersOf,
  progressStatus,
} from "../core/items/holdings.mjs";
import { spendBankHalves, spendBankOnBuilds } from "../core/items/bank.mjs";
import { coveredKeys, movedInto, movesInto } from "../core/items/moves.mjs";
import {
  itemStock,
  movableItems,
  ownedItems,
  readyRecipes,
} from "../core/items/owned.mjs";
import {
  fillRecipe,
  hasAll,
  spend,
  takeAll,
  takeHalf,
  takeItem,
  takeOne,
} from "../core/items/stock.mjs";
import { HOLD_VALUE, resolveHoldings } from "../item-holdings.mjs";
import { itemEdge } from "../item-edge.mjs";
import { compItems } from "../v2/js/comp-items.js";
import { nextItemRecipe } from "../v2/js/next-item.js";
import * as viaSource from "../v2/js/item-source.js";
import { countUnitTraits, firstBreakpoint } from "../v2/js/traits.js";
import { importsOf, stripNonCode } from "./architecture/scan.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(
  readFileSync(path.join(root, "catalog.json"), "utf8"),
);

/* ---------- Sorteio determinístico ---------- */

/** mulberry32: o mesmo sorteio em toda máquina. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const sample = (rand, list, n) =>
  Array.from({ length: n }, () => pick(rand, list));
const distinct = (rand, list, n) => {
  const pool = [...list],
    out = [];
  while (out.length < n && pool.length)
    out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
};
const shuffle = (rand, list) => distinct(rand, list, list.length);

/* ---------- Universo sintético de itens ---------- */

const C = ["A", "B", "C", "D", "E"].map((n) => `DA_Component_${n}`),
  SPATULA = "DA_Component_Spatula",
  PAN = "DA_Component_FryingPan";
const RECIPES = {
  DA_I1: [C[0], C[1]],
  DA_I2: [C[0], C[2]],
  DA_I3: [C[1], C[2]],
  DA_I4: [C[2], C[3]],
  DA_I5: [C[3], C[4]],
  DA_I6: [C[0], C[0]],
  DA_I7: [C[1], C[4]],
};
const COMPLETED = Object.keys(RECIPES),
  RADIANTS = ["DA_I1_Radiant", "DA_I2Radiant", "DA_I5_Radiant"],
  ARTIFACT = "DA_Artifact_Z",
  CONSUMABLE_ID = "DA_Consumable_Remover";
// Onze emblemas: 6 com a Espátula e 5 com a Frigideira (as duas viram "bases" com 5 receitas ou mais).
const EMBLEMS = Array.from({ length: 11 }, (_, i) => ({
  id: `DA_Emblem_T${i + 1}`,
  trait: `T${i + 1}`,
  composition: [i < 6 ? SPATULA : PAN, C[i % C.length]],
}));
const compositionOf = (id) =>
  RECIPES[id] ?? EMBLEMS.find((e) => e.id === id)?.composition ?? [];

/** O mapa de itens como /api/catalog o entrega à aba Comps (ver v2/js/comp-items.test.mjs). */
function itemsMap() {
  const out = new Map(),
    add = (id, kind, extra = {}) =>
      out.set(id, {
        id,
        name: id,
        composition: [],
        kind,
        consumable: false,
        trait: null,
        ...extra,
      });
  for (const id of [...C, SPATULA, PAN]) add(id, "component");
  for (const id of COMPLETED)
    add(id, "completed", { composition: RECIPES[id] });
  for (const id of RADIANTS) add(id, "radiant");
  add(ARTIFACT, "artifact");
  add(CONSUMABLE_ID, "other", { consumable: true });
  for (const e of EMBLEMS)
    add(e.id, "emblem", { composition: e.composition, trait: e.trait });
  return out;
}
const ITEMS = itemsMap();
const ANY_ITEM = [
  ...COMPLETED,
  ...RADIANTS,
  ...C,
  SPATULA,
  PAN,
  ARTIFACT,
  ...EMBLEMS.map((e) => e.id),
];

/* ---------- Cópias das implementações antigas (sem mudança de lógica) ---------- */

/** v2/js/item-source.js (antes do M6). */
const legacyBase = (id) => String(id ?? "").replace(/_?Radiant$/, "");
const legacyIsComponent = (id) => id.startsWith("DA_Component_");

function legacyOwnersOf(units, goalIds, wants = () => []) {
  return units
    .filter((u) => (u.itemNames ?? []).length)
    .map((u) => ({
      unitId: u.championName,
      name: u.name ?? u.championName,
      stars: u.starLevel ?? 1,
      zone: u.zone ?? "board",
      stays: goalIds.has(u.championName),
      items: (u.itemNames ?? []).map(legacyBase),
      wants: wants(u.championName).map(legacyBase),
    }));
}

function legacyLocateItem(
  item,
  { cellId, equipped = [], bank = [], owners = [], moves = [] },
) {
  const id = legacyBase(item.id);
  if (equipped.some((e) => legacyBase(e.id) === id))
    return { kind: "on", text: "equipado" };
  if (bank.some((b) => legacyBase(b) === id))
    return { kind: "ready", text: "pronto no banco" };

  const others = owners.filter((o) => o.unitId !== cellId),
    rank = (o) => (!o.stays ? 0 : !o.wants.includes(id) ? 1 : 2),
    order = (a, b) => rank(a) - rank(b);
  const planned = moves.find((m) => m.itemId === id)?.fromId,
    holders = others.filter((o) => o.items.includes(id)).sort(order),
    from = holders.find((o) => o.unitId === planned) ?? holders[0];
  if (from) {
    const asTaken = rank(from) === 2 && from.unitId !== planned;
    return asTaken
      ? { kind: "taken", text: `só em ${from.name}`, from }
      : { kind: "move", text: `mover de ${from.name}`, from };
  }

  const parts = (item.components ?? []).map((c) => c.id),
    left = [...bank],
    pool = others
      .filter((o) => rank(o) < 2)
      .sort(order)
      .map((o) => ({ owner: o, items: [...o.items] })),
    have = [],
    got = [],
    fetched = [];
  for (const p of parts) {
    const at = left.indexOf(p);
    const src =
      at < 0 && legacyIsComponent(p)
        ? pool.find((s) => s.items.includes(p))
        : null;
    if (at >= 0) left.splice(at, 1);
    else if (src) {
      src.items.splice(src.items.indexOf(p), 1);
      fetched.push({ id: p, from: src.owner });
    }
    got.push(at >= 0 || !!src);
    if (at >= 0 || src) have.push(p);
  }
  const full = parts.length > 0 && have.length === parts.length;
  if (full && fetched.length) {
    const names = [...new Set(fetched.map((f) => f.from.name))].join(" e ");
    return {
      kind: "move",
      text: `mover componente de ${names} e montar`,
      from: fetched[0].from,
      parts: fetched,
      have,
      got,
    };
  }
  if (full) return { kind: "ready", text: "monta agora", have, got };
  const missing = parts.length - have.length;
  return {
    kind: have.length ? "half" : "need",
    text: have.length ? `falta ${missing}` : "",
    have,
    got,
    missing,
    ...(fetched.length ? { parts: fetched } : {}),
  };
}

/** item-holdings.mjs:resolveHoldings (antes do M6), sobre o locateItem/ownersOf antigos. */
const LEGACY_AVAILABLE = new Set([
  "on",
  "bank",
  "move",
  "moveStay",
  "craft",
  "craftMove",
]);
function legacyResolveHoldings({
  builds = {},
  order = null,
  units = [],
  goalIds = new Set(),
  bank = [],
  compositionOf = () => [],
  carryId = null,
}) {
  const takeBase = (list, id) => {
    const at = list.findIndex((x) => legacyBase(x) === id);
    if (at < 0) return false;
    list.splice(at, 1);
    return true;
  };
  const plan = (order ?? Object.keys(builds)).filter(
      (u) => builds[u]?.length && goalIds.has(u),
    ),
    owners = legacyOwnersOf(
      units.map((u) => ({
        championName: u.unitId,
        name: u.name,
        starLevel: u.stars,
        itemNames: u.items ?? [],
      })),
      goalIds,
      (id) => builds[id] ?? [],
    ),
    byUnit = new Map(owners.map((o) => [o.unitId, o])),
    entries = new Map(
      plan.map((u) => [
        u,
        builds[u].map((id) => ({
          unit: u,
          id,
          kind: null,
          value: 0,
          from: null,
        })),
      ]),
    ),
    bankLeft = [...bank],
    positioned = new Map();
  for (const u of units)
    if (u.keeps && byUnit.has(u.unitId)) byUnit.get(u.unitId).stays = true;
  const settle = (e, kind, from = null) => {
    e.kind = kind;
    e.value = HOLD_VALUE[kind];
    e.available = LEGACY_AVAILABLE.has(kind);
    e.from = from;
  };
  for (const u of plan) {
    const o = byUnit.get(u);
    for (const e of entries.get(u)) {
      const id = legacyBase(e.id);
      if (!o || !takeBase(o.items, id)) continue;
      settle(e, "on", o.name);
      positioned.set(id, [...(positioned.get(id) ?? []), o.name]);
    }
  }
  for (const o of owners)
    o.wants = (entries.get(o.unitId) ?? [])
      .filter((e) => !e.kind)
      .map((e) => legacyBase(e.id));
  for (const u of plan) {
    const o = byUnit.get(u);
    const spendPart = (p) => {
      if (!takeBase(bankLeft, p) && o) takeBase(o.items, p);
    };
    for (const e of entries.get(u)) {
      if (e.kind) continue;
      const id = legacyBase(e.id),
        own = o ? o.items.filter(legacyIsComponent) : [],
        res = legacyLocateItem(
          { id, components: compositionOf(id).map((c) => ({ id: c })) },
          { cellId: u, equipped: [], bank: [...bankLeft, ...own], owners },
        );
      if (res.kind === "ready" && !res.have) {
        takeBase(bankLeft, id);
        settle(e, "bank");
      } else if (res.kind === "ready") {
        for (const p of res.have) spendPart(p);
        settle(e, "craft");
      } else if (res.kind === "move" && res.parts) {
        const rest = [...res.have];
        for (const f of res.parts) {
          takeBase(rest, f.id);
          takeBase(f.from.items, f.id);
        }
        for (const p of rest) spendPart(p);
        settle(
          e,
          "craftMove",
          [...new Set(res.parts.map((f) => f.from.name))].join(" e "),
        );
      } else if (res.kind === "move") {
        takeBase(res.from.items, id);
        settle(e, res.from.stays ? "moveStay" : "move", res.from.name);
      } else if (res.kind === "half") settle(e, "half");
      else if (positioned.has(id)) settle(e, "taken", positioned.get(id)[0]);
      else
        settle(
          e,
          res.kind === "taken" ? "taken" : "absent",
          res.from?.name ?? null,
        );
    }
  }
  const count = (list) => {
    const out = Object.fromEntries(Object.keys(HOLD_VALUE).map((k) => [k, 0]));
    for (const e of list) out[e.kind ?? "absent"]++;
    return out;
  };
  const all = [...entries.values()].flat();
  return {
    entries,
    counts: count(all),
    carry: count(entries.get(carryId) ?? []),
  };
}

/** v2/js/comp-items.js:compItems (antes do M6), com emblemBases/traitsToGain copiados. */
const legacyBaseItemId = (id) => String(id).replace(/_?Radiant$/, "");
function legacyEmblemBases(items) {
  const count = new Map();
  for (const i of items.values())
    if (i.kind === "emblem" && i.composition?.length === 2)
      for (const p of i.composition) count.set(p, (count.get(p) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= 5).map(([p]) => p));
}
function legacyTraitsToGain(comp, carryTraits, champions, breakpoints) {
  const counts = countUnitTraits(comp.units, (id) => champions.get(id)?.traits);
  return new Set(
    [...counts]
      .filter(
        ([t, n]) =>
          !carryTraits.has(t) && n + 1 >= firstBreakpoint(breakpoints.get(t)),
      )
      .map(([t]) => t),
  );
}
const LEGACY_REASONS = {
  component: "componente sem receita útil para esta comp",
  completed: "item fora da build desta comp",
  radiant: "radiante de um item fora da build desta comp",
  artifact: "artefato fora da build desta comp",
  emblem: "emblema cuja sinergia o carry não aproveita nesta comp",
  other: "item sem uso nesta comp",
  unknown: "item fora do catálogo",
};
function legacyCompItems(
  comp,
  { bank = [], equipped = {}, items, champions, breakpoints = new Map() },
) {
  const read = Array.isArray(bank),
    stock = [],
    excluded = [];
  for (const id of read ? bank : [])
    (items.get(id)?.consumable ? excluded : stock).push(id);
  const take = (match) => {
    const at = stock.findIndex(match);
    return at < 0 ? null : stock.splice(at, 1)[0];
  };
  const units = [comp.carry, ...comp.units.filter((u) => u !== comp.carry)]
    .filter((u, i, all) => comp.builds?.[u]?.length && all.indexOf(u) === i)
    .map((unit) => ({
      unit,
      isCarry: unit === comp.carry,
      rows: comp.builds[unit].map((want) => ({
        want,
        state: "missing",
        spent: [],
        have: [],
        missing: [],
        recipe: items.get(want)?.composition ?? [],
      })),
      owned: [...(equipped[unit] ?? [])],
    }));
  for (const u of units)
    for (const row of u.rows) {
      const worn = u.owned.findIndex((id) => legacyBaseItemId(id) === row.want);
      if (worn >= 0) {
        u.owned.splice(worn, 1);
        row.state = "on";
        continue;
      }
      const exact =
        take((id) => id === row.want) ??
        take((id) => legacyBaseItemId(id) === row.want);
      if (exact) {
        Object.assign(row, {
          state: exact === row.want ? "ready" : "radiant",
          spent: [exact],
        });
        continue;
      }
      if (row.recipe.length === 2) {
        const probe = [...stock];
        const parts = row.recipe.map((p) => {
          const at = probe.indexOf(p);
          return at < 0 ? null : probe.splice(at, 1)[0];
        });
        if (parts.every(Boolean)) {
          for (const p of parts) take((id) => id === p);
          Object.assign(row, { state: "craft", spent: parts, have: parts });
        }
      }
    }
  const carryTraits = new Set(champions.get(comp.carry)?.traits ?? []),
    wanted = legacyTraitsToGain(comp, carryTraits, champions, breakpoints),
    bases = legacyEmblemBases(items),
    emblems = [];
  for (const [id, item] of items)
    if (item.kind === "emblem" && wanted.has(item.trait)) {
      const bankId = take((x) => x === id);
      if (bankId)
        emblems.push({
          id,
          trait: item.trait,
          state: "ready",
          spent: [id],
          have: [],
          missing: [],
          recipe: item.composition ?? [],
        });
    }
  const inBuild = new Set(units.flatMap((u) => u.rows.map((r) => r.want)));
  for (const [id, item] of items)
    if (
      item.kind === "emblem" &&
      wanted.has(item.trait) &&
      item.composition?.length === 2 &&
      !inBuild.has(id) &&
      !emblems.some((e) => e.trait === item.trait)
    ) {
      const probe = [...stock],
        parts = item.composition.map((p) => {
          const at = probe.indexOf(p);
          return at < 0 ? null : probe.splice(at, 1)[0];
        });
      if (parts.every(Boolean)) {
        for (const p of parts) take((x) => x === p);
        emblems.push({
          id,
          trait: item.trait,
          state: "craft",
          spent: parts,
          have: parts,
          missing: [],
          recipe: item.composition,
        });
      }
    }
  for (const u of units)
    for (const row of u.rows)
      if (row.state === "missing" && row.recipe.length === 2) {
        const part = row.recipe.find((p) => stock.includes(p));
        if (part) {
          take((id) => id === part);
          const rest = [...row.recipe];
          rest.splice(rest.indexOf(part), 1);
          Object.assign(row, {
            state: "half",
            spent: [part],
            have: [part],
            missing: rest,
          });
        }
      }
  const spentBase = new Set();
  for (const [id, item] of items)
    if (
      item.kind === "emblem" &&
      wanted.has(item.trait) &&
      item.composition?.length === 2 &&
      !inBuild.has(id) &&
      !emblems.some((e) => e.trait === item.trait)
    ) {
      const part = item.composition.find(
        (p) => bases.has(p) && (stock.includes(p) || spentBase.has(p)),
      );
      if (!part) continue;
      const first = !spentBase.has(part);
      if (first) {
        take((x) => x === part);
        spentBase.add(part);
      }
      emblems.push({
        id,
        trait: item.trait,
        state: "half",
        alt: !first,
        spent: first ? [part] : [],
        have: [part],
        missing: item.composition.filter((p) => p !== part),
        recipe: item.composition,
      });
    }
  const unused = stock.map((id) => {
    const kind = items.get(id)?.kind;
    return {
      id,
      kind: kind ?? null,
      reason:
        LEGACY_REASONS[
          kind ? (LEGACY_REASONS[kind] ? kind : "other") : "unknown"
        ],
    };
  });
  return { read, units, emblems, unused, excluded };
}

/** v2/js/next-item.js:nextItemRecipe (antes do M6). */
const legacyIds = (list) =>
  (list ?? []).map((c) => (typeof c === "string" ? c : c?.id)).filter(Boolean);
function legacyNextItemRecipe(
  item,
  catalogItems = new Map(),
  { bank = null } = {},
) {
  if (!item?.id) return null;
  const name = (id) =>
    catalogItems.get(id)?.name ?? String(id).replace(/^DA_(Component_)?/, "");
  const baseId = legacyBase(item.id),
    radiant = baseId !== item.id,
    recipeOf = radiant ? baseId : item.id;
  const sent = legacyIds(item.components),
    recipe =
      sent.length && !radiant
        ? sent
        : legacyIds(catalogItems.get(recipeOf)?.composition);
  const main = { id: item.id, name: item.name ?? name(item.id) },
    base = radiant ? { id: baseId, name: name(baseId) } : null;
  if (recipe.length < 2 && !radiant)
    return {
      item: main,
      base: null,
      parts: [],
      radiant: false,
      complete: false,
    };
  const missingIds = [...(item.missingIds ?? [])];
  const missingNames = [...(item.missing ?? [])];
  const informed =
    !radiant && (item.missingIds != null || item.missing != null);
  const held = item.usesHeld ?? null;
  let heldUsed = false;
  const stock = bank ? [...bank] : null;
  const parts = recipe.map((id) => {
    const label = name(id);
    if (informed) {
      const byId = missingIds.indexOf(id),
        byName = byId < 0 ? missingNames.indexOf(label) : -1;
      if (byId >= 0 || byName >= 0) {
        if (byId >= 0) missingIds.splice(byId, 1);
        else missingNames.splice(byName, 1);
        return { id, name: label, state: "missing" };
      }
      if (held === id && !heldUsed) {
        heldUsed = true;
        return { id, name: label, state: "equipped" };
      }
      return { id, name: label, state: "bank" };
    }
    if (!stock) return { id, name: label, state: "unknown" };
    const at = stock.indexOf(id);
    if (at < 0) return { id, name: label, state: "missing" };
    stock.splice(at, 1);
    return { id, name: label, state: "bank" };
  });
  return {
    item: main,
    base,
    parts,
    radiant,
    complete: parts.length > 0 && parts.every((p) => p.state !== "missing"),
  };
}

/** tactics.mjs:build (laço de estoque), antes do M6. */
function legacyFill(required, inventory, heldParts) {
  const stock = [...inventory],
    missing = [],
    held = [...heldParts];
  let usesHeld = null;
  for (const id of required) {
    const h = required.length === 2 && !usesHeld ? held.indexOf(id) : -1;
    if (h >= 0) {
      held.splice(h, 1);
      usesHeld = id;
      continue;
    }
    const at = stock.indexOf(id);
    if (at < 0) missing.push(id);
    else stock.splice(at, 1);
  }
  return { missing, usesHeld };
}

/** tactics.mjs:ownedItemAdvice: `missing` de uma escolha e o gasto do banco restante. */
function legacyMissing(inventory, required) {
  const check = [...inventory],
    missing = [];
  for (const id of required) {
    const at = check.indexOf(id);
    if (at >= 0) check.splice(at, 1);
    else missing.push(id);
  }
  return missing;
}
function legacySpendReady(remaining, required) {
  const check = [...remaining];
  for (const id of required) {
    const at = check.indexOf(id);
    if (at < 0) return null;
    check.splice(at, 1);
  }
  return check;
}

/** tactics.mjs: coveredByMoves; stage.mjs: movedIn; plan-progress.mjs: moved; model.js: moves (todos antes do M6). */
const legacyCovered = (moves) =>
  new Set(
    moves.flatMap((m) => (m.moves ?? []).map((x) => `${x.to.id}:${x.item.id}`)),
  );
function legacyMovedIn(itemMoves) {
  const out = new Map();
  for (const m of itemMoves ?? [])
    for (const x of m.moves ?? []) {
      if (!out.has(x.to.id)) out.set(x.to.id, new Set());
      out.get(x.to.id).add(baseItemId(x.item.id));
    }
  return out;
}
const legacyMoved = (itemMoves, id, itemId) =>
  (itemMoves ?? []).find((m) =>
    (m.moves ?? []).some(
      (x) => x.to?.id === id && baseItemId(x.item.id) === baseItemId(itemId),
    ),
  );
const legacyModelMoves = (itemMoves, id) =>
  (itemMoves ?? []).flatMap((m) =>
    (m.moves ?? [])
      .filter((x) => x.to?.id === id)
      .map((x) => ({ itemId: legacyBase(x.item.id), fromId: m.from.id })),
  );

/** item-plan.mjs:kindOf (origem do item -> situação), antes do M6. */
function legacyKindOf(itemOrigin, partOrigins, unitId) {
  if (itemOrigin) {
    const f = itemOrigin;
    return f.type === "bank"
      ? "bank"
      : f.type === "leaving"
        ? "move"
        : f.unitId === unitId
          ? "on"
          : "moveStay";
  }
  return partOrigins.every(
    (p) => p.type === "bank" || (p.type === "unit" && p.unitId === unitId),
  )
    ? "craft"
    : "craftMove";
}

/** plan-progress.mjs: cadeia de status do item-alvo, antes do M6. */
function legacyProgress({ built, moved, live, plan, remembered }) {
  let status = "missing";
  if (built) status = "built";
  else if (moved) status = "move";
  else if (live?.craftable) status = "ready";
  else if (
    Array.isArray(live?.missing) &&
    live.missing.length < (live.components?.length ?? 0)
  )
    status = "partial";
  else if (!plan && remembered) status = "built";
  return status;
}

/** item-edge.mjs: caminho sem localização, antes do M6 (lê só o estoque agregado). */
function legacyEdgeHits(items, have, recipes) {
  const completed = (have?.completed ?? []).map(baseItemId),
    components = [...(have?.components ?? [])];
  const take = (list, id) => {
    const at = list.indexOf(id);
    if (at < 0) return false;
    list.splice(at, 1);
    return true;
  };
  const ready = [],
    craft = [];
  for (const id of items) {
    if (take(completed, id)) ready.push(id);
    else {
      const parts = recipes.get(id) ?? [];
      const spare = [...components];
      if (parts.length === 2 && parts.every((p) => take(spare, p))) {
        components.splice(0, components.length, ...spare);
        craft.push(id);
      }
    }
  }
  return { ready, craft };
}

/* ---------- Geradores de cenários ---------- */

const UNIT_IDS = ["U0", "U1", "U2", "U3", "U4", "U5"];

/** Cenário de posse comp a comp: peças da comp com build, peças do jogador (as que ficam e as que saem) e o banco. */
function holdingsScenario(rand) {
  const goal = UNIT_IDS.filter(() => rand() < 0.55);
  if (!goal.length) goal.push("U0");
  const builds = {};
  for (const u of goal)
    builds[u] = distinct(
      rand,
      [...COMPLETED, ARTIFACT],
      1 + Math.floor(rand() * 3),
    );
  // Uma peça fora da comp com build: tem de ser ignorada.
  for (const u of UNIT_IDS)
    if (!goal.includes(u) && rand() < 0.2) builds[u] = [pick(rand, COMPLETED)];
  const owned = [...COMPLETED, ...RADIANTS, ...C, ARTIFACT];
  const units = UNIT_IDS.filter(() => rand() < 0.8).map((u) => ({
    unitId: u,
    name: `Nome ${u}`,
    stars: 1 + Math.floor(rand() * 3),
    items: sample(rand, owned, Math.floor(rand() * 4)),
    keeps: rand() < 0.12,
  }));
  const bank = sample(rand, owned, Math.floor(rand() * 8));
  const order = rand() < 0.7 ? shuffle(rand, goal) : null;
  return {
    builds,
    order,
    units,
    goalIds: new Set(goal),
    bank,
    compositionOf,
    carryId: (order ?? goal)[0],
  };
}

/** Cenário da aba Comps: comp sintética (4 campeões, builds de 1 a 3 itens), banco misto e itens equipados. */
function compScenario(rand) {
  const champions = new Map(
    ["U0", "U1", "U2", "U3"].map((id) => [
      id,
      {
        id,
        traits: distinct(
          rand,
          EMBLEMS.map((e) => e.trait),
          1 + Math.floor(rand() * 2),
        ),
      },
    ]),
  );
  const unitIds = [...champions.keys()],
    builds = {};
  for (const u of unitIds)
    if (rand() < 0.85)
      builds[u] = distinct(
        rand,
        [...COMPLETED, ARTIFACT, ...EMBLEMS.slice(0, 3).map((e) => e.id)],
        1 + Math.floor(rand() * 3),
      );
  const comp = { units: unitIds, carry: "U0", builds };
  const equipped = {};
  for (const u of unitIds)
    if (rand() < 0.5)
      equipped[u] = sample(
        rand,
        [...COMPLETED, ...RADIANTS, ...C],
        Math.floor(rand() * 3),
      );
  const bank =
    rand() < 0.06
      ? null
      : [
          ...sample(rand, ANY_ITEM, Math.floor(rand() * 9)),
          ...(rand() < 0.3 ? [CONSUMABLE_ID, "DA_ForaDoCatalogo"] : []),
        ];
  const breakpoints = new Map(EMBLEMS.map((e) => [e.trait, [2, 4]]));
  return {
    comp,
    ctx: { bank, equipped, items: ITEMS, champions, breakpoints },
  };
}

/* ---------- Estoque (stock.mjs) ---------- */

test("stock: takeOne/takeItem/takeAll/spend/takeHalf/hasAll fazem o que os laços de indexOf+splice faziam", () => {
  const rand = rng(11);
  for (let n = 0; n < 300; n++) {
    const list = sample(
        rand,
        [...C, ...COMPLETED, ...RADIANTS],
        Math.floor(rand() * 9),
      ),
      id = pick(rand, [...C, ...COMPLETED, "DA_I1_Radiant", "DA_Nada"]);
    // takeOne exato = indexOf + splice.
    const a = [...list],
      b = [...list],
      at = a.indexOf(id),
      expected = at < 0 ? null : a.splice(at, 1)[0];
    assert.equal(takeOne(b, id), expected);
    assert.deepEqual(b, a);
    // takeOne com predicado = findIndex + splice.
    const c = [...list],
      d = [...list],
      pAt = c.findIndex((x) => x.endsWith("A")),
      pExpected = pAt < 0 ? null : c.splice(pAt, 1)[0];
    assert.equal(
      takeOne(d, (x) => x.endsWith("A")),
      pExpected,
    );
    assert.deepEqual(d, c);
    // takeAll: tudo ou nada.
    const need = sample(rand, C, 1 + Math.floor(rand() * 2)),
      before = [...list],
      shortage = legacyMissing(list, need),
      got = takeAll(before, need);
    if (shortage.length) {
      assert.equal(got, null);
      assert.deepEqual(
        before,
        list,
        "faltou componente: o estoque fica intacto",
      );
    } else {
      assert.deepEqual(got, need);
      assert.equal(before.length, list.length - need.length);
    }
    // spend/hasAll não mexem no original e dizem o que falta e o que sobra.
    const frozen = [...list],
      s = spend(list, need);
    assert.deepEqual(list, frozen);
    assert.deepEqual(s.missing, shortage);
    assert.equal(hasAll(list, need), shortage.length === 0);
    assert.equal(s.left.length, list.length - (need.length - shortage.length));
  }
});

test("stock: o radiante vale o item base e a cópia exata sai primeiro", () => {
  const bank = ["DA_I1_Radiant", "DA_I1", "DA_I2Radiant"];
  assert.equal(takeItem(bank, "DA_I1"), "DA_I1");
  assert.deepEqual(bank, ["DA_I1_Radiant", "DA_I2Radiant"]);
  assert.equal(takeItem(bank, "DA_I1"), "DA_I1_Radiant");
  assert.equal(takeItem(bank, "DA_I2"), "DA_I2Radiant");
  assert.equal(takeItem(bank, "DA_I2"), null);
  assert.deepEqual(bank, []);
  const half = ["DA_Component_B"];
  assert.deepEqual(takeHalf(half, RECIPES.DA_I1), {
    have: ["DA_Component_B"],
    missing: ["DA_Component_A"],
  });
  assert.deepEqual(half, []);
  assert.equal(takeHalf(half, RECIPES.DA_I1), null);
});

test("stock: fillRecipe = o laço de tactics.build (banco uma vez e uma peça solta que a peça já leva)", () => {
  const rand = rng(23);
  for (let n = 0; n < 400; n++) {
    const required = sample(rand, C, rand() < 0.2 ? 1 : 2),
      inventory = sample(rand, C, Math.floor(rand() * 5)),
      heldParts = sample(rand, C, Math.floor(rand() * 3));
    const old = legacyFill(required, inventory, heldParts),
      frozen = [[...inventory], [...heldParts]];
    assert.deepEqual(
      fillRecipe(required, { stock: inventory, held: heldParts }),
      old,
    );
    assert.deepEqual([inventory, heldParts], frozen, "não muta o que recebe");
  }
});

test("stock: spend = os laços de ownedItemAdvice (missing de uma escolha e gasto do banco restante)", () => {
  const rand = rng(31);
  for (let n = 0; n < 300; n++) {
    const required = sample(
        rand,
        [...C, ...COMPLETED],
        1 + Math.floor(rand() * 2),
      ),
      inventory = sample(rand, [...C, ...COMPLETED], Math.floor(rand() * 7));
    assert.deepEqual(
      spend(inventory, required).missing,
      legacyMissing(inventory, required),
    );
    const left = legacySpendReady(inventory, required),
      s = spend(inventory, required);
    assert.equal(s.missing.length === 0, left !== null);
    if (left) assert.deepEqual(s.left, left);
  }
});

/* ---------- Posse (holdings.mjs) ---------- */

test("holdings: locateItem e ownersOf (Formação) = a implementação antiga em cenários sorteados", () => {
  const rand = rng(41);
  for (let n = 0; n < 400; n++) {
    const s = holdingsScenario(rand),
      units = s.units.map((u) => ({
        championName: u.unitId,
        name: u.name,
        starLevel: u.stars,
        itemNames: u.items,
        zone: rand() < 0.5 ? "board" : "reserve",
      }));
    const wants = (id) => s.builds[id] ?? [];
    assert.deepEqual(
      ownersOf(units, s.goalIds, wants),
      legacyOwnersOf(units, s.goalIds, wants),
    );
    const owners = ownersOf(units, s.goalIds, wants),
      cellId = pick(rand, UNIT_IDS),
      itemId = pick(rand, [...COMPLETED, ARTIFACT, ...RADIANTS]),
      item = {
        id: itemId,
        components: compositionOf(baseItemId(itemId)).map((id) => ({ id })),
      },
      args = {
        cellId,
        equipped: sample(
          rand,
          [...COMPLETED, ...RADIANTS],
          Math.floor(rand() * 2),
        ).map((id) => ({ id })),
        bank: s.bank,
        owners,
        moves:
          rand() < 0.4
            ? [{ itemId: baseItemId(itemId), fromId: pick(rand, UNIT_IDS) }]
            : [],
      };
    // Diferenças aceitas (M6), só quando há peça que FICA e USA o item (build pede e ela tem): (1) cópia sobrando (tem 2,
    // a build pede 1) é cedida, a regra antiga dizia 'taken'; (2) com componentes no banco o item monta ('ready'/'half'),
    // a regra antiga dizia 'taken'. Ver os testes "cópia sobrando" e "taken só sem como montar".
    const base = baseItemId(itemId),
      userStays = owners.some(
        (o) =>
          o.unitId !== args.cellId &&
          o.stays &&
          o.wants.includes(base) &&
          o.items.includes(base),
      );
    if (!userStays)
      assert.deepEqual(locateItem(item, args), legacyLocateItem(item, args));
  }
  assert.equal(viaSource.locateItem, locateItem, "item-source.js só reexporta");
  assert.equal(viaSource.ownersOf, ownersOf);
  assert.equal(viaSource.buildStates, buildStates);
  assert.equal(viaSource.baseItem, baseItemId);
});

test("holdings: taken só sem como montar: com os componentes no banco o item monta, mesmo existindo numa peça que o usa", () => {
  const item = { id: "DA_I1", components: RECIPES.DA_I1.map((id) => ({ id })) },
    user = {
      unitId: "U1",
      name: "Um",
      stars: 2,
      zone: "board",
      stays: true,
      items: ["DA_I1"],
      wants: ["DA_I1"],
    },
    args = { cellId: "U0", owners: [user] };
  assert.equal(locateItem(item, args).kind, "taken");
  assert.equal(
    locateItem(item, { ...args, bank: [...RECIPES.DA_I1] }).text,
    "monta agora",
  );
  const half = locateItem(item, { ...args, bank: [RECIPES.DA_I1[0]] });
  assert.equal(half.kind, "half");
  // O motor tem a mesma precedência: monta/metade antes de 'taken'.
  const engine = (bank) =>
    classifyHoldings({
      builds: { U0: ["DA_I1"], U1: ["DA_I1"] },
      order: ["U0", "U1"],
      units: [{ unitId: "U1", name: "Um", stars: 2, items: ["DA_I1"] }],
      goalIds: new Set(["U0", "U1"]),
      bank,
      compositionOf,
      carryId: "U0",
    }).entries.get("U0")[0].kind;
  assert.equal(engine([]), "taken");
  assert.equal(engine([...RECIPES.DA_I1]), "craft");
  assert.equal(engine([RECIPES.DA_I1[0]]), "half");
  // A peça que fica e já tem o item que usa cede os componentes soltos (o motor também): monta com um do banco.
  const [partA, partB] = RECIPES.DA_I1,
    lend = locateItem(item, {
      cellId: "U0",
      bank: [partB],
      owners: [{ ...user, items: ["DA_I1", partA] }],
    });
  assert.equal(lend.kind, "move");
  assert.ok(lend.parts, "monta com o componente solto da peça que fica");
  assert.equal(
    classifyHoldings({
      builds: { U0: ["DA_I1"], U1: ["DA_I1"] },
      order: ["U0", "U1"],
      units: [{ unitId: "U1", name: "Um", stars: 2, items: ["DA_I1", partA] }],
      goalIds: new Set(["U0", "U1"]),
      bank: [partB],
      compositionOf,
      carryId: "U0",
    }).entries.get("U0")[0].kind,
    "craftMove",
  );
  // Já a peça que fica e AINDA precisa do item guarda os componentes para montá-lo (nem a Formação nem o motor os tiram).
  const needs = { ...user, items: [partA] };
  assert.equal(
    locateItem(item, { cellId: "U0", bank: [partB], owners: [needs] }).kind,
    "half",
  );
});

test("holdings: cópia sobrando de uma peça que fica pode ser cedida; a única cópia que ela usa só informa (taken)", () => {
  const IE = { id: "DA_I1", components: [] },
    owner = (items) => ({
      unitId: "U1",
      name: "Um",
      stars: 2,
      zone: "board",
      stays: true,
      items,
      wants: ["DA_I1"],
    });
  // Uma cópia, e a build da peça a pede: 'taken' (como sempre).
  assert.equal(
    locateItem(IE, { cellId: "U0", owners: [owner(["DA_I1"])] }).kind,
    "taken",
  );
  // Duas cópias para uma build que pede uma: sobra uma, é 'move' de uma peça que fica.
  const spare = locateItem(IE, {
    cellId: "U0",
    owners: [owner(["DA_I1", "DA_I1"])],
  });
  assert.equal(spare.kind, "move");
  assert.equal(spare.from.stays, true);
  // O motor concorda (T4): a peça que fica gasta a cópia que usa e a outra vai para quem pede.
  const engine = classifyHoldings({
    builds: { U0: ["DA_I1"], U1: ["DA_I1"] },
    order: ["U0", "U1"],
    units: [{ unitId: "U1", name: "Um", stars: 2, items: ["DA_I1", "DA_I1"] }],
    goalIds: new Set(["U0", "U1"]),
    compositionOf,
    carryId: "U0",
  });
  assert.deepEqual(
    [engine.entries.get("U0")[0].kind, engine.entries.get("U1")[0].kind],
    ["moveStay", "on"],
  );
});

test("holdings: classifyHoldings + HOLD_VALUE (item-holdings.resolveHoldings) = o resolveHoldings antigo, item a item", () => {
  const rand = rng(53);
  const seen = new Set();
  // Roda pelo menos 600 cenários e continua (até 4000) enquanto o sorteio não tiver produzido toda situação.
  for (let n = 0; n < 4000 && (n < 600 || seen.size < HOLD_KINDS.length); n++) {
    const s = holdingsScenario(rand),
      now = resolveHoldings(s),
      old = legacyResolveHoldings(s);
    assert.deepEqual(now, old, `cenário ${n}`);
    for (const list of now.entries.values())
      for (const e of list) seen.add(e.kind);
  }
  // O sorteio exercita todas as situações (se uma sumisse do sorteio, a comparação acima não cobriria a regra dela).
  for (const kind of HOLD_KINDS)
    assert.ok(seen.has(kind), `o sorteio nunca produziu '${kind}'`);
});

test("holdings: cada cópia de item e cada componente é gasto uma vez (nenhuma situação a mais do que existe)", () => {
  const rand = rng(61);
  for (let n = 0; n < 400; n++) {
    const s = holdingsScenario(rand),
      { entries } = classifyHoldings(s);
    const have = new Map();
    for (const id of [...s.bank, ...s.units.flatMap((u) => u.items)])
      have.set(baseItemId(id), (have.get(baseItemId(id)) ?? 0) + 1);
    const used = new Map();
    for (const list of entries.values())
      for (const e of list)
        if (["on", "bank", "move", "moveStay"].includes(e.kind))
          used.set(baseItemId(e.id), (used.get(baseItemId(e.id)) ?? 0) + 1);
    for (const [id, count] of used)
      assert.ok(
        count <= (have.get(id) ?? 0),
        `${id}: ${count} situações para ${have.get(id) ?? 0} cópias (cenário ${n})`,
      );
    for (const list of entries.values())
      for (const e of list) {
        assert.ok(HOLD_KINDS.includes(e.kind), e.kind);
        assert.equal(e.available, AVAILABLE_KINDS.has(e.kind));
      }
  }
});

test("holdings: radiante vale o item base, em quem sai, em quem fica e no banco", () => {
  const s = {
    builds: { U0: ["DA_I1", "DA_I2"] },
    units: [
      { unitId: "U0", name: "Zero", stars: 2, items: ["DA_I1_Radiant"] },
      { unitId: "U1", name: "Um", stars: 1, items: ["DA_I2Radiant"] },
    ],
    goalIds: new Set(["U0"]),
    bank: [],
    compositionOf,
    carryId: "U0",
  };
  const { entries } = classifyHoldings(s);
  assert.deepEqual(
    entries.get("U0").map((e) => e.kind),
    ["on", "move"],
  );
  assert.equal(
    classifyHoldings({
      ...s,
      units: [],
      bank: ["DA_I1Radiant", "DA_I2_Radiant"],
    })
      .entries.get("U0")
      .map((e) => e.kind)
      .join(),
    "bank,bank",
  );
});

test("holdings: kindFromOrigin / craftKindFromOrigins / progressStatus = os blocos antigos de item-plan e plan-progress", () => {
  const rand = rng(71);
  for (let n = 0; n < 400; n++) {
    const unitId = pick(rand, ["U0", "U1"]),
      origin = () =>
        pick(rand, [
          { type: "bank", name: "banco" },
          { type: "leaving", name: "Saindo" },
          { type: "unit", unitId: "U0", name: "Zero" },
          { type: "unit", unitId: "U1", name: "Um" },
        ]);
    const one = origin(),
      two = [origin(), origin()];
    assert.equal(kindFromOrigin(one, unitId), legacyKindOf(one, null, unitId));
    assert.equal(
      craftKindFromOrigins(two, unitId),
      legacyKindOf(null, two, unitId),
    );
    const input = {
      built: rand() < 0.2,
      moved: rand() < 0.2,
      live:
        rand() < 0.8
          ? {
              craftable: rand() < 0.3,
              missing:
                rand() < 0.8
                  ? sample(rand, C, Math.floor(rand() * 3))
                  : undefined,
              components: sample(rand, C, 2),
            }
          : undefined,
      plan: rand() < 0.5 ? {} : undefined,
      remembered: rand() < 0.5,
    };
    const status =
      progressStatus({
        built: input.built,
        moved: input.moved,
        craftable: !!input.live?.craftable,
        missing: input.live?.missing,
        parts: input.live?.components?.length ?? 0,
      }) ?? (!input.plan && input.remembered ? "built" : "missing");
    assert.equal(status, legacyProgress(input), JSON.stringify(input));
  }
});

test("holdings: HOLD_VALUE (política do motor) cobre exatamente as situações do núcleo", () => {
  assert.deepEqual(Object.keys(HOLD_VALUE), HOLD_KINDS);
  assert.ok([...AVAILABLE_KINDS].every((k) => HOLD_KINDS.includes(k)));
  for (const kind of HOLD_KINDS)
    assert.equal(
      AVAILABLE_KINDS.has(kind),
      HOLD_VALUE[kind] >= 0.85,
      `${kind}: ao alcance = vale pelo menos 0,85`,
    );
});

/* ---------- Banco entre as builds (bank.mjs) e a aba Comps ---------- */

test("aba Comps: compItems (agora sobre core/items/bank.mjs) = o compItems antigo, linha a linha, emblemas e sobras", () => {
  const rand = rng(83);
  const states = new Set(),
    WANTED = [
      "on",
      "ready",
      "radiant",
      "craft",
      "half",
      "missing",
      "emblema:ready",
      "emblema:craft",
      "emblema:half",
    ];
  // Pelo menos 500 cenários; continua (até 6000) enquanto o sorteio não tiver produzido todo estado de linha e de emblema.
  for (
    let n = 0;
    n < 6000 && (n < 500 || WANTED.some((s) => !states.has(s)));
    n++
  ) {
    const { comp, ctx } = compScenario(rand);
    const now = compItems(comp, ctx),
      old = legacyCompItems(comp, ctx);
    assert.deepEqual(now, old, `cenário ${n}`);
    for (const u of now.units) for (const row of u.rows) states.add(row.state);
    for (const e of now.emblems) states.add(`emblema:${e.state}`);
  }
  for (const state of WANTED)
    assert.ok(states.has(state), `o sorteio nunca produziu '${state}'`);
});

test("banco: spendBankOnBuilds/spendBankHalves gastam cada item uma vez e mantêm o estoque coerente", () => {
  const rand = rng(89);
  for (let n = 0; n < 300; n++) {
    const bank = sample(
        rand,
        [...COMPLETED, ...RADIANTS, ...C],
        Math.floor(rand() * 10),
      ),
      units = ["U0", "U1", "U2"].map((unit) => ({
        unit,
        owned: sample(rand, COMPLETED, Math.floor(rand() * 2)),
        rows: distinct(rand, COMPLETED, 1 + Math.floor(rand() * 3)).map(
          (want) => ({
            want,
            state: "missing",
            spent: [],
            have: [],
            missing: [],
            recipe: RECIPES[want],
          }),
        ),
      })),
      stock = [...bank];
    spendBankOnBuilds(units, stock);
    spendBankHalves(units, stock);
    const spent = units.flatMap((u) => u.rows.flatMap((r) => r.spent));
    assert.deepEqual(
      [...spent, ...stock].sort(),
      [...bank].sort(),
      "nada some nem conta duas vezes",
    );
  }
});

/* ---------- Próximo item (next-item.js) ---------- */

test("próximo item: nextItemRecipe (agora com takeOne) = o antigo, com e sem informação do servidor", () => {
  const rand = rng(97);
  const catalogItems = new Map(
    [...ITEMS].map(([id, i]) => [
      id,
      { name: `N ${id}`, composition: i.composition },
    ]),
  );
  for (let n = 0; n < 500; n++) {
    const id = pick(rand, [...COMPLETED, ...RADIANTS, ARTIFACT]),
      recipe = RECIPES[baseItemId(id)] ?? [],
      informed = rand() < 0.6,
      item = {
        id,
        ...(rand() < 0.3 ? { name: "Nome do servidor" } : {}),
        ...(rand() < 0.3 ? { components: recipe.map((c) => ({ id: c })) } : {}),
        ...(informed && rand() < 0.5
          ? { missingIds: sample(rand, recipe, Math.floor(rand() * 3)) }
          : {}),
        ...(informed && rand() < 0.5
          ? {
              missing: sample(rand, recipe, Math.floor(rand() * 3)).map(
                (c) => `N ${c}`,
              ),
            }
          : {}),
        ...(rand() < 0.4
          ? { usesHeld: pick(rand, recipe.length ? recipe : C) }
          : {}),
      },
      bank = rand() < 0.3 ? null : sample(rand, C, Math.floor(rand() * 5));
    assert.deepEqual(
      nextItemRecipe(item, catalogItems, { bank }),
      legacyNextItemRecipe(item, catalogItems, { bank }),
      JSON.stringify({ item, bank }),
    );
  }
});

/* ---------- Passar itens (moves.mjs) ---------- */

function movesScenario(rand) {
  const ids = [...COMPLETED, ...RADIANTS, "DA_Component_A"];
  return Array.from({ length: Math.floor(rand() * 4) }, () => ({
    from: { id: pick(rand, UNIT_IDS), name: "De" },
    leaving: rand() < 0.5,
    moves: Array.from({ length: Math.floor(rand() * 3) }, () => ({
      item: { id: pick(rand, ids) },
      to: { id: pick(rand, UNIT_IDS), name: "Para" },
    })),
  }));
}

test("passar itens: movedInto / coveredKeys / movesInto = os laços de stage, tactics, plan-progress e model", () => {
  const rand = rng(101);
  for (let n = 0; n < 400; n++) {
    const itemMoves = movesScenario(rand);
    assert.deepEqual(movedInto(itemMoves), legacyMovedIn(itemMoves));
    // O laço antigo do tactics comparava o id cru do item; o núcleo compara o item base (radiante = item base).
    const raw = legacyCovered(itemMoves),
      base = coveredKeys(itemMoves);
    assert.deepEqual(
      [...base].sort(),
      [...new Set([...raw].map((k) => k.replace(/_?Radiant$/, "")))].sort(),
    );
    for (const u of UNIT_IDS) {
      assert.deepEqual(
        movesInto(itemMoves, u).map(({ itemId, fromId }) => ({
          itemId,
          fromId,
        })),
        legacyModelMoves(itemMoves, u),
      );
      const itemId = pick(rand, COMPLETED);
      assert.equal(
        movesInto(itemMoves, u).find((x) => x.itemId === baseItemId(itemId))
          ?.from ?? null,
        legacyMoved(itemMoves, u, itemId)?.from ?? null,
      );
    }
  }
  assert.deepEqual(movedInto(undefined), new Map());
  assert.deepEqual(movesInto(null, "U0"), []);
});

/* ---------- Contas sem localização (owned.mjs, item-edge, engine) ---------- */

test("owned: itemStock, readyRecipes e movableItems = as contas do engine.mjs antes do M6", () => {
  const rand = rng(107),
    realParts = catalog.items
      .filter((i) => isComponent(i.apiName))
      .map((i) => i.apiName),
    bankIds = [...realParts, ...realParts, ...COMPLETED];
  for (let n = 0; n < 200; n++) {
    const equipped = sample(rand, bankIds, Math.floor(rand() * 5)),
      bank = sample(rand, bankIds, Math.floor(rand() * 8)),
      all = ownedItems(equipped, bank);
    assert.deepEqual(all, [...equipped, ...bank]);
    assert.deepEqual(itemStock(all), {
      completed: all.filter((id) => !isComponent(id)),
      components: all.filter(isComponent),
    });
    // engine.mjs:readyRecipes (antes): para cada receita comum, os componentes do banco, gastos uma vez.
    const old = standardRecipes(catalog.items).filter((i) => {
      const stock = [...bank];
      for (const id of i.composition) {
        const at = stock.indexOf(id);
        if (at < 0) return false;
        stock.splice(at, 1);
      }
      return true;
    });
    assert.deepEqual(readyRecipes(catalog.items, bank), old);
    const leaving = sample(
      rand,
      [...COMPLETED, ...RADIANTS],
      Math.floor(rand() * 3),
    );
    assert.deepEqual(movableItems(bank, leaving), [
      ...bank.map((id) => ({ id, leaving: false })),
      ...leaving.map((id) => ({ id: legacyBase(id), leaving: true })),
    ]);
  }
  // Com o catálogo real: o banco com todos os componentes fecha todas as receitas comuns.
  const parts = catalog.items
    .filter((i) => isComponent(i.apiName))
    .map((i) => i.apiName);
  assert.ok(readyRecipes(catalog.items, [...parts, ...parts]).length > 20);
  assert.equal(isEmblemTool(SPATULA) && isEmblemTool(PAN), true);
});

test("item-edge: o caminho sem localização (estoque agregado) gasta cada item e componente uma vez, como antes", () => {
  const rand = rng(113),
    recipes = new Map(Object.entries(RECIPES));
  for (let n = 0; n < 300; n++) {
    const buildItems = distinct(rand, COMPLETED, 3),
      have = {
        completed: sample(
          rand,
          [...COMPLETED, ...RADIANTS],
          Math.floor(rand() * 4),
        ),
        components: sample(rand, C, Math.floor(rand() * 6)),
      },
      old = legacyEdgeHits(buildItems, have, recipes),
      comp = {
        avg: 4.5,
        units: ["U"],
        buildStats: { U: { items: buildItems, delta: -0.6, n: 60000 } },
      },
      edge = itemEdge(comp, have, recipes);
    const gain = edge.gains[0];
    if (!old.ready.length && !old.craft.length) assert.equal(gain, undefined);
    else {
      assert.deepEqual(gain.ready, old.ready);
      assert.deepEqual(gain.craft, old.craft);
    }
  }
});

/* ---------- T4: Formação = motor = aba Comps no mesmo estado ---------- */

/** Formação (locateItem) -> situação do motor, para um item só. */
function formationAsKind(state) {
  if (state.kind === "on") return "on";
  if (state.kind === "ready") return state.have ? "craft" : "bank";
  if (state.kind === "move")
    return state.parts ? "craftMove" : state.from.stays ? "moveStay" : "move";
  if (state.kind === "half") return "half";
  if (state.kind === "taken") return "taken";
  return "absent";
}

test("T4: a Formação e o motor concordam sobre cada item de uma peça (falta / existe em outra peça / monta agora)", () => {
  const rand = rng(127);
  const seen = new Set(),
    ALL = [...HOLD_KINDS];
  // Pelo menos 800 cenários; continua (até 8000) enquanto o sorteio não tiver produzido toda situação.
  for (let n = 0; n < 8000 && (n < 800 || seen.size < ALL.length); n++) {
    // A peça U0 pede UM item (e só tem itens prontos equipados); as outras peças da comp podem ter build e gastam o que
    // têm; as de fora saem. Compara-se o item de U0 (a Formação não gasta um item para o seguinte, o motor sim).
    const want = pick(rand, COMPLETED),
      goal = ["U0", ...UNIT_IDS.slice(1).filter(() => rand() < 0.5)],
      builds = { U0: [want] };
    for (const u of goal.slice(1))
      if (rand() < 0.6)
        builds[u] = distinct(rand, COMPLETED, 1 + Math.floor(rand() * 2));
    const units = UNIT_IDS.filter(() => rand() < 0.8).map((u) => ({
      unitId: u,
      name: `Nome ${u}`,
      stars: 2,
      items: sample(
        rand,
        u === "U0"
          ? [...COMPLETED, ...RADIANTS]
          : [...COMPLETED, ...RADIANTS, ...C],
        Math.floor(rand() * 4),
      ),
    }));
    const bank = sample(
      rand,
      [...COMPLETED, ...RADIANTS, ...C],
      Math.floor(rand() * 7),
    );
    const engine = classifyHoldings({
      builds,
      order: Object.keys(builds),
      units,
      goalIds: new Set(goal),
      bank,
      compositionOf,
      carryId: "U0",
    });
    const owners = ownersOf(
        units.map((u) => ({
          championName: u.unitId,
          name: u.name,
          starLevel: u.stars,
          itemNames: u.items,
        })),
        new Set(goal),
        (id) => builds[id] ?? [],
      ),
      mine = units.find((u) => u.unitId === "U0"),
      formation = locateItem(
        { id: want, components: compositionOf(want).map((id) => ({ id })) },
        {
          cellId: "U0",
          equipped: (mine?.items ?? []).map((id) => ({ id })),
          bank,
          owners,
        },
      );
    const kind = engine.entries.get("U0")[0].kind;
    // Se a peça U0 nem existe no jogo (sem itens), `ownersOf` não a lista, mas a Formação só a usa como `cellId`.
    assert.equal(kind, formationAsKind(formation), `cenário ${n}`);
    seen.add(kind);
  }
  for (const kind of [
    "on",
    "bank",
    "craft",
    "move",
    "moveStay",
    "craftMove",
    "half",
    "taken",
    "absent",
  ])
    assert.ok(seen.has(kind), `T4 nunca exercitou '${kind}'`);
});

test("T4: a aba Comps e o motor concordam sobre o banco (monta agora / no banco / falta)", () => {
  const rand = rng(131);
  // Mapa estado da aba Comps -> situações do motor aceitas. A aba só olha banco e o que a peça já usa; o motor também olha
  // outras peças, que aqui não têm item sobrando (só o que a própria build pede). A metade de receita da aba gasta o
  // componente; o motor não, por isso 'missing' pode ser 'half' ou 'taken' no motor, nunca o contrário.
  const FULL = { on: "on", ready: "bank", radiant: "bank", craft: "craft" };
  const seen = new Set(),
    tabStates = () => new Set([...seen].map((s) => s.split("->")[0])),
    STATES = ["on", "ready", "radiant", "craft", "half", "missing"];
  // Pelo menos 600 cenários; continua (até 6000) enquanto o sorteio não tiver produzido todo estado da aba.
  for (
    let n = 0;
    n < 6000 && (n < 600 || tabStates().size < STATES.length);
    n++
  ) {
    const unitIds = ["U0", "U1", "U2"],
      builds = Object.fromEntries(
        unitIds.map((u) => [
          u,
          distinct(rand, COMPLETED, 1 + Math.floor(rand() * 3)),
        ]),
      ),
      // Equipado só com itens da própria build (ou o radiante deles): nada sobra para outra peça.
      equipped = Object.fromEntries(
        unitIds.map((u) => [
          u,
          builds[u]
            .filter(() => rand() < 0.35)
            .map((id) => (rand() < 0.3 ? `${id}_Radiant` : id)),
        ]),
      ),
      bank = sample(
        rand,
        [...COMPLETED, ...RADIANTS, ...C],
        Math.floor(rand() * 8),
      ),
      comp = { units: unitIds, carry: "U0", builds },
      champions = new Map(unitIds.map((id) => [id, { id, traits: [] }])),
      tab = compItems(comp, {
        bank,
        equipped,
        items: ITEMS,
        champions,
        breakpoints: new Map(),
      }),
      engine = classifyHoldings({
        builds,
        order: unitIds,
        units: unitIds
          .filter((u) => equipped[u].length)
          .map((u) => ({ unitId: u, name: u, stars: 2, items: equipped[u] })),
        goalIds: new Set(unitIds),
        bank,
        compositionOf,
        carryId: "U0",
      });
    for (const u of tab.units)
      u.rows.forEach((row, i) => {
        const kind = engine.entries.get(u.unit)[i].kind;
        seen.add(`${row.state}->${kind}`);
        if (row.state in FULL)
          assert.equal(
            kind,
            FULL[row.state],
            `${u.unit}/${row.want} (cenário ${n})`,
          );
        else if (row.state === "half")
          assert.equal(kind, "half", `${u.unit}/${row.want} (cenário ${n})`);
        else
          assert.ok(
            ["absent", "half", "taken"].includes(kind),
            `${u.unit}/${row.want}: aba 'missing', motor '${kind}' (cenário ${n})`,
          );
      });
  }
  for (const state of ["on", "ready", "radiant", "craft", "half", "missing"])
    assert.ok(
      [...seen].some((s) => s.startsWith(`${state}->`)),
      `T4 nunca exercitou '${state}' na aba Comps`,
    );
});

/* ---------- Pureza e uso ---------- */

test("core/items: só importa de core/, sem node:*, relógio, aleatório nem E/S", () => {
  for (const file of ["stock", "holdings", "bank", "moves", "owned"]) {
    const rel = `core/items/${file}.mjs`,
      // Sem comentários nem textos: os comentários do núcleo citam "node:*" e "Date.now" para dizer que não os usam.
      src = stripNonCode(readFileSync(path.join(root, rel), "utf8"));
    for (const spec of importsOf(rel))
      assert.ok(
        spec.startsWith("./") || spec.startsWith("../catalog/"),
        `${rel} importa ${spec}`,
      );
    assert.ok(
      !/\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\bprocess\.|\bfetch\(|\brequire\(/.test(
        src,
      ),
      rel,
    );
  }
});

test("os consumidores leem o núcleo: nenhum define de novo a posse de itens nem importa v2/js/item-source.js", () => {
  for (const rel of [
    "engine.mjs",
    "item-holdings.mjs",
    "item-plan.mjs",
    "item-value.mjs",
    "item-edge.mjs",
    "tactics.mjs",
    "stage.mjs",
    "plan-progress.mjs",
    "carousel.mjs",
  ])
    assert.ok(
      !importsOf(rel).some((s) => /item-source/.test(s)),
      `${rel} ainda importa v2/js/item-source.js`,
    );
  for (const rel of [
    "v2/js/comp-items.js",
    "v2/js/next-item.js",
    "v2/js/model.js",
    "v2/js/ui/champ-items.js",
  ])
    assert.ok(
      !importsOf(rel).some((s) => /item-source/.test(s)),
      `${rel} ainda importa o reexport; use o núcleo`,
    );
  // O reexport fino só reexporta.
  assert.deepEqual(importsOf("v2/js/item-source.js"), [
    "../../core/items/holdings.mjs",
  ]);
});
