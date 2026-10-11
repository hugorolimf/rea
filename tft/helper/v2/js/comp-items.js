/**
 * Itens do banco do jogador que combinam com o carry (e com as outras peças) de uma comp de meta.
 * Puro: recebe a comp, o banco lido da tela e o catálogo; não decide a comp nem altera o motor.
 *
 * Cada item do banco cai em exatamente um destino (`spent` das linhas e dos emblemas, `unused` ou `excluded`):
 *  - consumível (Removedor, Duplicadores, Reforjador, Poções, Boosters, Melhoria do Mestre-Artesão, Baú da Sorte):
 *    `excluded`. Não é para montar nem equipar; fica fora da lista de sinergia (o catálogo diz quem é, `consumable`);
 *  - item da build publicada de um campeão da comp (o carry primeiro): `ready` (o próprio item), `radiant` (o radiante
 *    do item da build), `craft` (os dois componentes do banco montam o item), `half` (um componente; diz o que falta) ou
 *    `missing` (nada no banco; mostra a receita, vazia para artefato, que não se monta);
 *  - emblema que dá ao carry uma sinergia da comp que ele não tem e que, com ele, chega a um patamar (`emblems`): `ready` (o emblema), `craft`
 *    (Espátula/Frigideira + componente) ou `half` (só Espátula/Frigideira, que é a peça escassa dos emblemas);
 *  - o resto (componente sem receita útil, completo de outra build, artefato ou radiante sem uso, emblema que o carry
 *    não aproveita, item fora do catálogo): `unused`, com o motivo.
 * O item equipado no campeão (`equipped`) conta como `on` e não gasta o banco.
 */
import { countUnitTraits, firstBreakpoint } from "./traits.js";

/** Id do item base de um radiante ("DA_VoidStaffRadiant" e "DA_TitansResolve_Radiant" valem o item comum). */
export const baseItemId = (id) => String(id).replace(/_?Radiant$/, "");

const REASONS = {
  component: "componente sem receita útil para esta comp",
  completed: "item fora da build desta comp",
  radiant: "radiante de um item fora da build desta comp",
  artifact: "artefato fora da build desta comp",
  emblem: "emblema cuja sinergia o carry não aproveita nesta comp",
  other: "item sem uso nesta comp",
  unknown: "item fora do catálogo",
};

/** Peças que entram em várias receitas de emblema (Espátula e Frigideira), derivadas do catálogo. */
export function emblemBases(items) {
  const count = new Map();
  for (const i of items.values())
    if (i.kind === "emblem" && i.composition?.length === 2)
      for (const p of i.composition) count.set(p, (count.get(p) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n >= 5).map(([p]) => p));
}

/**
 * Sinergias que o emblema dá ao carry com proveito: as que ele não tem e que, com ele, chegam ao primeiro patamar
 * (`breakpoints`: Map sinergia → patamares; sem o patamar conhecido, 2) contando os campeões da comp que já a têm.
 */
function traitsToGain(comp, carryTraits, champions, breakpoints) {
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

/**
 * @param comp `{units, carry, builds}` (como /api/comps).
 * @param ctx `bank`: ids do banco (null = banco não lido); `equipped`: {idDoCampeão: [ids]}; `items`: Map id → item do
 *   catálogo (`kind`, `consumable`, `composition`, `trait`); `champions`: Map id → {traits}; `breakpoints`: Map sinergia → patamares.
 */
export function compItems(
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
  // Passo 1: equipado, o próprio item, o radiante e a montagem completa (carry antes, cada item do banco uma vez só).
  for (const u of units)
    for (const row of u.rows) {
      const worn = u.owned.findIndex((id) => baseItemId(id) === row.want);
      if (worn >= 0) {
        u.owned.splice(worn, 1);
        row.state = "on";
        continue;
      }
      const exact =
        take((id) => id === row.want) ??
        take((id) => baseItemId(id) === row.want);
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
  // Emblemas que dão ao carry uma sinergia ativa da comp que ele ainda não tem.
  const carryTraits = new Set(champions.get(comp.carry)?.traits ?? []),
    wanted = traitsToGain(comp, carryTraits, champions, breakpoints),
    bases = emblemBases(items),
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
  // Passo 2: metade de uma receita (um componente no banco; diz o que falta). Emblema só com Espátula/Frigideira.
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
  // A Espátula/Frigideira serve a qualquer emblema útil: cada um vira uma alternativa (`alt`) e só a primeira gasta a peça.
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
      reason: REASONS[kind ? (REASONS[kind] ? kind : "other") : "unknown"],
    };
  });
  return { read, units, emblems, unused, excluded };
}

/** Linhas em que o banco ou o campeão tem algo (para listar peças que não são o carry sem ruído). */
export const touched = (u) => u.rows.some((r) => r.state !== "missing");

/** Quantos itens do banco entram na comp (linhas e emblemas que gastam algo do banco). */
export const spentCount = (r) =>
  r.units.flatMap((u) => u.rows).reduce((n, row) => n + row.spent.length, 0) +
  r.emblems.reduce((n, e) => n + e.spent.length, 0);

/** Itens equipados por campeão no seu tabuleiro (`self.units` do servidor: {championName, itemNames}); cópias do mesmo campeão somam. */
export function equippedBy(units = []) {
  const out = {};
  for (const u of units ?? [])
    if (u?.championName && Array.isArray(u.itemNames) && u.itemNames.length)
      out[u.championName] = [...(out[u.championName] ?? []), ...u.itemNames];
  return out;
}
